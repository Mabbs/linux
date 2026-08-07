// SPDX-License-Identifier: MIT
//
// hostfs.js —— 把浏览器 File System Access API 选中的本地目录，适配成
// vendor/linux 的 virtio-fs 设备所需要的 `FS<TNode, THandle>` 后端。
//
// 设计要点（对照 vendor/linux/dist/virtio/fs.{js,d.ts}）：
//
//  * 设备只在构造时读一次 `filesystem.root`，之后用 WeakMap 按对象身份缓存
//    nodeid。所以同一个路径必须永远返回同一个 node 对象，否则客户机看到的
//    inode 会不停变化。这里用每个目录节点上的 children Map 做身份缓存。
//  * 设备在 spawnMachine 之前就要拿到设备对象，运行中无法热插拔。因此 root
//    节点一开始 handle 为 null（表现为一个空目录），用户点按钮选好文件夹后
//    再把真正的 FileSystemDirectoryHandle 挂上去，客户机侧无需重新挂载。
//  * 缺省的方法会被设备直接回 ENOSYS，所以 symlink/readlink 干脆不实现
//    （FSA API 本身也没有符号链接的概念）。
//  * 只要实现了 write/create，设备就强制要求同时有 flush/fsync。
//  * 名字必须是单个合法 UTF-8 路径分量，且 UTF-8 编码 <= 255 字节，否则设备
//    会抛 EINVAL 把整个 readdir 打断，这里在列目录时提前过滤掉。
//
// 写入策略：FSA 的 createWritable() 是「整篇覆盖 + close 时提交」的语义，
// 没法直接映射 FUSE 的随机写。所以文件一旦被写，就把内容整体读进内存做
// 可增长缓冲区，读写都走内存，flush/fsync/最后一次 release 时整篇写回。

import { FSError } from "./vendor/linux/dist/index.js";

const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;

const O_ACCMODE = 0o3;
const O_TRUNC = 0o1000;

const DIR_MODE = 0o755;
const FILE_MODE = 0o644;

const STAT_TTL_MS = 300;          // getattr 结果的短缓存，避免 ls 时反复 getFile()
const GROW_CHUNK = 64 * 1024;     // 缓冲区最小增长步长，保证追加写是摊还 O(n)
const WRITE_CHUNK = 4 * 1024 * 1024;
const MAX_NAME_BYTES = 255;

const encoder = new TextEncoder();
const monotonic = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/** 浏览器是否具备挂载本地目录所需的全部能力。 */
export const HOSTFS_SUPPORTED =
  typeof globalThis.showDirectoryPicker === "function" &&
  typeof globalThis.FileSystemDirectoryHandle === "function";

function timestamp(ms) {
  const seconds = Math.floor(ms / 1000);
  return {
    seconds: BigInt(seconds),
    nanoseconds: Math.round((ms - seconds * 1000) * 1e6),
  };
}

/** 把 DOMException 翻译成客户机能理解的 errno。 */
function toFSError(error) {
  if (error instanceof FSError) return error;
  switch (error && error.name) {
    case "NotFoundError":
      return new FSError("ENOENT");
    case "TypeMismatchError":
      return new FSError("ENOTDIR");
    case "NotAllowedError":
    case "SecurityError":
      return new FSError("EACCES");
    case "NoModificationAllowedError":
      return new FSError("EROFS");
    case "InvalidModificationError":
      return new FSError("ENOTEMPTY");
    case "QuotaExceededError":
      return new FSError("ENOSPC");
    case "InvalidStateError":
    case "AbortError":
      return new FSError("EIO", String((error && error.message) || error));
    default:
      return new FSError("EIO", String((error && error.message) || error));
  }
}

function makeNode(kind, handle, parent, name) {
  return {
    kind,                                     // "dir" | "file"
    handle,                                   // FileSystemHandle | null
    parent,
    name,
    children: kind === "dir" ? new Map() : null,
    // 文件写缓冲
    data: null,                               // Uint8Array（容量可能大于 size）
    size: 0,
    loaded: false,
    dirty: false,
    // 元数据
    mode: null,                               // setattr/chmod 覆盖的权限位
    mtimeMs: null,
    stat: null,
    statAt: 0,
    opens: 0,
    gone: false,
  };
}

function nameTooLong(name) {
  return encoder.encode(name).byteLength > MAX_NAME_BYTES;
}

function usableName(name) {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\0") &&
    !nameTooLong(name)
  );
}

/**
 * 创建一个「可延迟绑定本地目录」的 virtio-fs 后端。
 *
 * @param {{ onChange?: (state: object) => void }} [options]
 * @returns 包含 `fs`（交给 fileSystemDevice）、`attach`、`detach`、`flush`、
 *          `getState` 的控制器。
 */
export function createHostDirectoryFS(options = {}) {
  const onChange = typeof options.onChange === "function" ? options.onChange : null;

  const root = makeNode("dir", null, null, "");
  const dirtyNodes = new Set();

  const state = {
    attached: false,
    name: "",
    readOnly: false,
    pendingWrites: 0,
  };

  function notify() {
    state.pendingWrites = dirtyNodes.size;
    if (onChange) {
      try {
        onChange({ ...state });
      } catch {
        /* UI 回调不应该影响文件系统 */
      }
    }
  }

  function markDirty(node) {
    if (!node.dirty) {
      node.dirty = true;
      dirtyNodes.add(node);
      notify();
    }
  }

  function clearDirty(node) {
    if (node.dirty) {
      node.dirty = false;
      dirtyNodes.delete(node);
      notify();
    }
  }

  function requireAttached() {
    if (!root.handle) throw new FSError("ENOENT", "没有绑定本地目录");
  }

  function requireWritable() {
    requireAttached();
    if (state.readOnly) throw new FSError("EROFS", "本地目录只读");
  }

  function requireDir(node) {
    if (node.gone) throw new FSError("ENOENT");
    if (node.kind !== "dir") throw new FSError("ENOTDIR");
    if (!node.handle) throw new FSError("ENOENT");
    return node.handle;
  }

  function requireFile(node) {
    if (node.gone) throw new FSError("ENOENT");
    if (node.kind !== "file") throw new FSError("EISDIR");
    if (!node.handle) throw new FSError("ENOENT");
    return node.handle;
  }

  // ---- 节点身份缓存 -------------------------------------------------------

  function linkChild(parent, name, kind, handle) {
    let node = parent.children.get(name);
    if (node && node.kind === kind) {
      node.handle = handle;
      node.gone = false;
      return node;
    }
    if (node) invalidate(node);          // 同名但类型变了，换一个身份
    node = makeNode(kind, handle, parent, name);
    parent.children.set(name, node);
    return node;
  }

  function invalidate(node) {
    node.gone = true;
    node.handle = null;
    clearDirty(node);
    node.data = null;
    node.loaded = false;
    if (node.children) {
      for (const child of node.children.values()) invalidate(child);
      node.children.clear();
    }
  }

  function unlinkChild(parent, name) {
    const node = parent.children.get(name);
    if (node) {
      parent.children.delete(name);
      invalidate(node);
    }
  }

  /** 在 parent 下解析 name，返回 { kind, handle } 或 null。 */
  async function probe(parent, name) {
    const handle = requireDir(parent);
    const cached = parent.children.get(name);
    // 先按上次的类型试，命中就只需要一次 API 调用
    const order =
      cached && cached.kind === "dir" ? ["dir", "file"] : ["file", "dir"];
    for (const kind of order) {
      try {
        const child =
          kind === "dir"
            ? await handle.getDirectoryHandle(name)
            : await handle.getFileHandle(name);
        return { kind, handle: child };
      } catch (error) {
        const code = error && error.name;
        if (code === "NotFoundError" || code === "TypeMismatchError") continue;
        throw toFSError(error);
      }
    }
    return null;
  }

  // ---- 文件内容 -----------------------------------------------------------

  async function loadContent(node) {
    if (node.loaded) return;
    const handle = requireFile(node);
    try {
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      node.data = bytes;
      node.size = bytes.byteLength;
      node.mtimeMs = file.lastModified;
    } catch (error) {
      throw toFSError(error);
    }
    node.loaded = true;
  }

  function reserve(node, needed) {
    const current = node.data ? node.data.byteLength : 0;
    if (current >= needed) return;
    const capacity = Math.max(needed, GROW_CHUNK, current * 2);
    const next = new Uint8Array(capacity);
    if (node.data) next.set(node.data.subarray(0, node.size));
    node.data = next;
  }

  function content(node) {
    if (!node.data) return new Uint8Array(0);
    return node.data.subarray(0, node.size);
  }

  function dropContent(node) {
    if (node.dirty || node.opens > 0) return;
    node.data = null;
    node.size = 0;
    node.loaded = false;
  }

  async function persist(node) {
    if (!node.dirty) return;
    requireWritable();
    const handle = requireFile(node);
    let writer;
    try {
      writer = await handle.createWritable({ keepExistingData: false });
      const body = content(node);
      for (let offset = 0; offset < body.byteLength; offset += WRITE_CHUNK) {
        await writer.write(
          body.subarray(offset, Math.min(body.byteLength, offset + WRITE_CHUNK)),
        );
      }
      await writer.close();
    } catch (error) {
      if (writer) {
        try {
          await writer.abort();
        } catch {
          /* 已经失败了，abort 的二次失败没有意义 */
        }
      }
      throw toFSError(error);
    }
    clearDirty(node);
    node.mtimeMs = Date.now();
    node.stat = { size: node.size, mtimeMs: node.mtimeMs };
    node.statAt = monotonic();
  }

  async function fileStat(node) {
    if (node.loaded) {
      return { size: node.size, mtimeMs: node.mtimeMs ?? Date.now() };
    }
    const at = monotonic();
    if (node.stat && at - node.statAt < STAT_TTL_MS) return node.stat;
    const handle = requireFile(node);
    try {
      const file = await handle.getFile();
      node.stat = { size: file.size, mtimeMs: file.lastModified };
      node.statAt = at;
      return node.stat;
    } catch (error) {
      throw toFSError(error);
    }
  }

  async function truncate(node, size) {
    const target = Number(size);
    if (!Number.isSafeInteger(target) || target < 0) throw new FSError("EINVAL");
    if (target === 0) {
      node.data = new Uint8Array(0);
      node.size = 0;
      node.loaded = true;
    } else {
      await loadContent(node);
      if (target > node.size) reserve(node, target);
      if (target > node.size && node.data) node.data.fill(0, node.size, target);
      node.size = target;
    }
    node.stat = null;
    node.mtimeMs = Date.now();
    markDirty(node);
  }

  // ---- 递归复制（rename 的兜底实现） --------------------------------------

  async function copyFileInto(sourceHandle, targetDir, name) {
    const file = await sourceHandle.getFile();
    const target = await targetDir.getFileHandle(name, { create: true });
    const writer = await target.createWritable({ keepExistingData: false });
    try {
      await writer.write(file);
      await writer.close();
    } catch (error) {
      try {
        await writer.abort();
      } catch {
        /* ignore */
      }
      throw error;
    }
    return target;
  }

  async function copyDirInto(sourceDir, targetDir) {
    for await (const [name, child] of sourceDir.entries()) {
      if (child.kind === "directory") {
        const nested = await targetDir.getDirectoryHandle(name, { create: true });
        await copyDirInto(child, nested);
      } else {
        await copyFileInto(child, targetDir, name);
      }
    }
  }

  function isAncestor(candidate, node) {
    for (let cursor = node; cursor; cursor = cursor.parent) {
      if (cursor === candidate) return true;
    }
    return false;
  }

  // ---- FS<TNode, THandle> -------------------------------------------------

  const fs = {
    root,

    async lookup(parent, name) {
      if (parent.kind !== "dir") throw new FSError("ENOTDIR");
      if (!parent.handle) return undefined;      // 还没绑定目录：空目录
      const found = await probe(parent, name);
      if (!found) {
        unlinkChild(parent, name);
        return undefined;
      }
      return linkChild(parent, name, found.kind, found.handle);
    },

    async getattr(node) {
      if (node.gone) throw new FSError("ENOENT");
      const nowMs = Date.now();
      if (node.kind === "dir") {
        const mtime = timestamp(node.mtimeMs ?? nowMs);
        return {
          mode: S_IFDIR | (node.mode ?? DIR_MODE),
          size: 4096n,
          blocks: 8n,
          nlink: 2,
          uid: 0,
          gid: 0,
          blockSize: 4096,
          atime: mtime,
          mtime,
          ctime: mtime,
        };
      }
      const stat = await fileStat(node);
      const mtime = timestamp(stat.mtimeMs);
      return {
        mode: S_IFREG | (node.mode ?? FILE_MODE),
        size: BigInt(stat.size),
        nlink: 1,
        uid: 0,
        gid: 0,
        blockSize: 4096,
        atime: mtime,
        mtime,
        ctime: mtime,
      };
    },

    async setattr(node, attributes) {
      if (node.gone) throw new FSError("ENOENT");
      if (attributes.mode !== undefined) {
        node.mode = attributes.mode & 0o7777;
      }
      if (attributes.size !== undefined) {
        requireWritable();
        if (node.kind !== "file") throw new FSError("EISDIR");
        await truncate(node, attributes.size);
        // 没有打开的文件句柄时（例如 truncate(1)），立即落盘
        if (node.opens === 0) await persist(node);
      }
      if (attributes.mtime !== undefined) {
        node.mtimeMs =
          attributes.mtime === "now"
            ? Date.now()
            : Number(attributes.mtime.seconds) * 1000 +
              Math.floor((attributes.mtime.nanoseconds ?? 0) / 1e6);
      }
      return fs.getattr(node);
    },

    async mkdir(parent, name, context) {
      requireWritable();
      const handle = requireDir(parent);
      let created;
      try {
        created = await handle.getDirectoryHandle(name, { create: true });
      } catch (error) {
        throw toFSError(error);
      }
      const node = linkChild(parent, name, "dir", created);
      node.mode = (context.mode & 0o7777) || DIR_MODE;
      node.mtimeMs = Date.now();
      return node;
    },

    async unlink(parent, name) {
      requireWritable();
      const handle = requireDir(parent);
      try {
        await handle.removeEntry(name);
      } catch (error) {
        throw toFSError(error);
      }
      unlinkChild(parent, name);
    },

    async rmdir(parent, name) {
      requireWritable();
      const handle = requireDir(parent);
      try {
        await handle.removeEntry(name);
      } catch (error) {
        if (error && error.name === "InvalidModificationError") {
          throw new FSError("ENOTEMPTY");
        }
        throw toFSError(error);
      }
      unlinkChild(parent, name);
    },

    async rename(oldParent, oldName, newParent, newName) {
      requireWritable();
      const from = requireDir(oldParent);
      const to = requireDir(newParent);
      if (oldParent === newParent && oldName === newName) return;

      const source = await probe(oldParent, oldName);
      if (!source) throw new FSError("ENOENT");

      const node = linkChild(oldParent, oldName, source.kind, source.handle);
      if (source.kind === "dir" && isAncestor(node, newParent)) {
        throw new FSError("EINVAL", "不能把目录移动到它自己的子目录里");
      }
      if (node.dirty) await persist(node);

      let moved = null;
      // Chromium 提供了非标准但很好用的 move()，先试它，失败再退回复制+删除。
      if (typeof source.handle.move === "function") {
        try {
          await source.handle.move(to, newName);
          moved = source.handle;
        } catch {
          moved = null;
        }
      }
      if (!moved) {
        try {
          if (source.kind === "file") {
            moved = await copyFileInto(source.handle, to, newName);
            await from.removeEntry(oldName);
          } else {
            moved = await to.getDirectoryHandle(newName, { create: true });
            await copyDirInto(source.handle, moved);
            await from.removeEntry(oldName, { recursive: true });
          }
        } catch (error) {
          throw toFSError(error);
        }
      }

      // 更新身份缓存：保留被移动节点本身的身份（inode 不变），
      // 目录的话把子树缓存丢掉，因为里面的 handle 已经指向旧位置了。
      oldParent.children.delete(oldName);
      const replaced = newParent.children.get(newName);
      if (replaced && replaced !== node) {
        newParent.children.delete(newName);
        invalidate(replaced);
      }
      if (node.children) {
        for (const child of node.children.values()) invalidate(child);
        node.children.clear();
      }
      node.parent = newParent;
      node.name = newName;
      node.handle = moved;
      node.stat = null;
      newParent.children.set(newName, node);
    },

    async open(node, flags) {
      requireFile(node);
      const access = flags & O_ACCMODE;
      if (access !== 0) requireWritable();
      if (flags & O_TRUNC) {
        requireWritable();
        await truncate(node, 0n);
      }
      node.opens += 1;
      return { node, writable: access !== 0 };
    },

    async create(parent, name, flags, context) {
      requireWritable();
      const handle = requireDir(parent);
      let created;
      try {
        created = await handle.getFileHandle(name, { create: true });
      } catch (error) {
        throw toFSError(error);
      }
      const node = linkChild(parent, name, "file", created);
      if (node.mode === null) node.mode = (context.mode & 0o7777) || FILE_MODE;
      node.stat = null;
      if (flags & O_TRUNC) await truncate(node, 0n);
      node.opens += 1;
      return { node, handle: { node, writable: true } };
    },

    async read(node, handle, offset, length) {
      requireFile(node);
      const start = Number(offset);
      if (!Number.isSafeInteger(start) || start < 0) throw new FSError("EINVAL");
      if (node.loaded) {
        if (start >= node.size) return new Uint8Array(0);
        return content(node).slice(start, Math.min(node.size, start + length));
      }
      try {
        const file = await node.handle.getFile();
        if (start >= file.size) return new Uint8Array(0);
        const slice = file.slice(start, Math.min(file.size, start + length));
        return new Uint8Array(await slice.arrayBuffer());
      } catch (error) {
        throw toFSError(error);
      }
    },

    async write(node, handle, offset, data) {
      requireWritable();
      requireFile(node);
      const start = Number(offset);
      if (!Number.isSafeInteger(start) || start < 0) throw new FSError("EINVAL");
      await loadContent(node);
      const end = start + data.byteLength;
      if (end > node.size) {
        reserve(node, end);
        if (start > node.size) node.data.fill(0, node.size, start);
        node.size = end;
      }
      node.data.set(data, start);
      node.stat = null;
      node.mtimeMs = Date.now();
      markDirty(node);
      return data.byteLength;
    },

    async flush(node) {
      if (node.dirty) await persist(node);
    },

    async fsync(node) {
      if (node.dirty) await persist(node);
    },

    async release(node) {
      if (node.opens > 0) node.opens -= 1;
      if (node.dirty) await persist(node);
      if (node.opens === 0) dropContent(node);
    },

    async opendir(node) {
      if (node.gone) throw new FSError("ENOENT");
      if (node.kind !== "dir") throw new FSError("ENOTDIR");
      const entries = [];
      if (node.handle) {
        const seen = new Set();
        try {
          for await (const [name, child] of node.handle.entries()) {
            if (!usableName(name)) continue;    // 设备会对非法分量抛 EINVAL
            seen.add(name);
            entries.push({
              name,
              node: linkChild(
                node,
                name,
                child.kind === "directory" ? "dir" : "file",
                child,
              ),
            });
          }
        } catch (error) {
          throw toFSError(error);
        }
        // 清掉本地已经消失的条目，避免缓存出幽灵文件
        for (const [name, child] of [...node.children]) {
          if (!seen.has(name) && !child.dirty && child.opens === 0) {
            node.children.delete(name);
            invalidate(child);
          }
        }
      }
      // 设备每次 READDIR 都会重建整个列表并按 off 跳过前 N 项，
      // 所以顺序必须稳定：这里排序后快照到句柄上。
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      node.opens += 1;
      return { node, entries };
    },

    readdir(node, handle) {
      return handle.entries;
    },

    releasedir(node) {
      if (node.opens > 0) node.opens -= 1;
    },

    access() {
      // 客户机里只有 root 在跑，权限交给宿主 API 自己判定。
    },

    statfs() {
      return {
        blocks: 1n << 20n,          // 4 KiB * 1M = 4 GiB，纯展示用
        blocksFree: 1n << 19n,
        blocksAvailable: 1n << 19n,
        files: 1n << 20n,
        filesFree: 1n << 19n,
        blockSize: 4096,
        fragmentSize: 4096,
        nameLength: MAX_NAME_BYTES,
      };
    },

    async destroy() {
      // 客户机 umount 会触发 DESTROY：只保证数据落盘，
      // 不销毁自身状态，这样重新 mount 还能继续用。
      await flushAll();
    },
  };

  // ---- 宿主侧控制接口 -----------------------------------------------------

  async function flushAll() {
    let firstError;
    for (const node of [...dirtyNodes]) {
      try {
        await persist(node);
      } catch (error) {
        firstError ??= error;
        dirtyNodes.delete(node);
        node.dirty = false;
      }
    }
    notify();
    if (firstError) throw firstError;
  }

  async function attach(directoryHandle) {
    if (!directoryHandle || directoryHandle.kind !== "directory") {
      throw new TypeError("需要一个 FileSystemDirectoryHandle");
    }
    if (root.handle) {
      try {
        await flushAll();
      } catch {
        /* 换目录时旧数据写不回去也不能卡住流程 */
      }
    }

    let permission = "granted";
    if (typeof directoryHandle.queryPermission === "function") {
      permission = await directoryHandle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted" &&
          typeof directoryHandle.requestPermission === "function") {
        permission = await directoryHandle.requestPermission({ mode: "readwrite" });
      }
    }
    const readOnly = permission !== "granted";
    if (readOnly && typeof directoryHandle.queryPermission === "function") {
      const readable = await directoryHandle.queryPermission({ mode: "read" });
      if (readable !== "granted") {
        throw new Error("没有拿到该文件夹的读取权限");
      }
    }

    for (const child of root.children.values()) invalidate(child);
    root.children.clear();
    dirtyNodes.clear();
    root.handle = directoryHandle;
    root.name = directoryHandle.name;
    root.gone = false;
    root.mtimeMs = Date.now();

    state.attached = true;
    state.name = directoryHandle.name;
    state.readOnly = readOnly;
    notify();
    return { name: directoryHandle.name, readOnly };
  }

  async function detach() {
    let firstError;
    if (root.handle) {
      try {
        await flushAll();
      } catch (error) {
        firstError = error;
      }
    }
    for (const child of root.children.values()) invalidate(child);
    root.children.clear();
    dirtyNodes.clear();
    root.handle = null;
    root.name = "";
    state.attached = false;
    state.name = "";
    state.readOnly = false;
    notify();
    if (firstError) throw firstError;
  }

  return {
    fs,
    attach,
    detach,
    flush: flushAll,
    getState: () => ({ ...state }),
  };
}
