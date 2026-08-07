// SPDX-License-Identifier: MIT
//
// hostfs.js —— 把浏览器 File System Access API 选中的本地目录，适配成
// vendor/linux 的 virtio-fs 设备所需要的 `FS<TNode, THandle>` 后端。
//

import { FSError } from "./vendor/linux/dist/index.js";

const FileType = {
  directory: 0o040000,
  file: 0o100000,
};

const OpenFlags = {
  EXCLUSIVE: 0x80,
  TRUNCATE: 0x200,
};

const MAX_NAME_BYTES = 255;

const utf8 = new TextEncoder();

function now() {
  const milliseconds = Date.now();
  return {
    seconds: BigInt(Math.floor(milliseconds / 1000)),
    nanoseconds: (milliseconds % 1000) * 1_000_000,
  };
}

// 设备侧 validate_name 已经做过 . / .. / / / \0 / 255 字节 的校验，这里再兜
// 一层，保持后端自包含。长度超限用 ENAMETOOLONG，与设备语义一致。
function valid_name(name) {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\0")
  ) {
    throw new FSError("EINVAL", "invalid path component");
  }
  if (utf8.encode(name).byteLength > MAX_NAME_BYTES) {
    throw new FSError("ENAMETOOLONG");
  }
  return name;
}

// DOMException -> FSError。与上游一致的错误映射。
function opfs_error(error) {
  if (error instanceof FSError) throw error;
  const name = error instanceof DOMException ? error.name : "";
  const code =
    {
      InvalidModificationError: "ENOTEMPTY",
      NoModificationAllowedError: "EACCES",
      NotAllowedError: "EACCES",
      NotFoundError: "ENOENT",
      QuotaExceededError: "ENOSPC",
      TypeMismatchError: "EINVAL",
    }[name] ?? "EIO";
  throw new FSError(
    code,
    error instanceof Error ? error.message : String(error),
  );
}

async function opfs_call(operation) {
  try {
    return await operation;
  } catch (error) {
    opfs_error(error);
  }
}

function checked_offset(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new FSError("EINVAL", "offset exceeds JavaScript's integer range");
  }
  return result;
}

function default_metadata(kind) {
  const timestamp = now();
  return {
    mode: FileType[kind] | (kind === "directory" ? 0o755 : 0o644),
    uid: 0,
    gid: 0,
    atime: timestamp,
    mtime: timestamp,
    mtimeOverride: false,
    ctime: timestamp,
  };
}

class Node {
  parts;
  handle;
  metadata;
  mutation = Promise.resolve();
  // 浏览器句柄标识的是“定位符”而非 inode 代次，可能因同名重建而重新指向。
  // 一旦观察到删除就永久分离这一代，让旧的客户机句柄失效，而不是重定向到新项。
  attached = true;

  constructor(parts, handle, metadata) {
    this.parts = parts;
    this.handle = handle;
    this.metadata = metadata;
  }
}

class Handle {
  node;

  constructor(node) {
    this.node = node;
  }
}

/**
 * 一个挂载到浏览器 FileSystemDirectoryHandle 的 virtio-fs 后端。
 *
 * 浏览器 File System API 不暴露 Unix 的属主 / 权限 / 链接 / inode 元数据，
 * 这里为它们合成常规的伪值，并在本对象生命周期内保留 chmod / chown / 时间戳
 * 的改动。
 *
 * rename 先复制到空目标再删除源，因为可移植的 API 没有原子的命名空间级
 * rename。失败时可能留下不完整的新目标，或（删源也失败时）两边都在。不支持
 * 替换已存在的目标。
 *
 * 浏览器句柄无法像 POSIX 描述符那样让一个已 unlink 的文件保持存活。本适配器
 * 一旦观察到删除，已有描述符就变为失效（而不是指向同名重建项）。一个“删除后
 * 重建、且未被观察到缺失状态”的情况无法区分。对单个适配器的写入 / 截断会按
 * 节点串行化，但其他适配器或应用仍可能与其可移植 API 操作产生竞态。
 */
class BrowserFS {
  root;
  #nodes = new Map();
  #attached = false;
  #readOnly = false;

  // 允许先用空 root（handle 为 null）构造，之后再 attach() 绑定真实目录，
  // 以适配本仓库“设备先建好、目录后选”的流程。
  constructor(root = null) {
    this.root = new Node([], root, default_metadata("directory"));
    this.#nodes.set("", this.root);
    this.#attached = root !== null;
  }

  #as_node(node) {
    if (!(node instanceof Node)) {
      throw new FSError("EINVAL", "node belongs to another filesystem");
    }
    if (!node.attached) {
      throw new FSError("ENOENT", "filesystem node is no longer attached");
    }
    return node;
  }

  #directory(node) {
    const result = this.#as_node(node);
    if (!result.handle) throw new FSError("ENOENT", "目录尚未绑定本地文件夹");
    if (result.handle.kind !== "directory") {
      throw new FSError("ENOTDIR");
    }
    return result.handle;
  }

  #remember(parts, handle) {
    const key = parts.join("/");
    let node = this.#nodes.get(key);
    if (!node) {
      node = new Node(parts, handle, default_metadata(handle.kind));
      this.#nodes.set(key, node);
    } else {
      node.handle = handle;
    }
    return node;
  }

  #forget(parts) {
    const key = parts.join("/");
    for (const [candidate, node] of this.#nodes) {
      if (candidate === key || candidate.startsWith(`${key}/`)) {
        node.attached = false;
        this.#nodes.delete(candidate);
      }
    }
  }

  #open_handle(node, handle) {
    const current = this.#as_node(node);
    if (!(handle instanceof Handle) || handle.node !== current) {
      throw new FSError("EBADF");
    }
    return current;
  }

  #mutate(node, operation) {
    const previous = node.mutation;
    let resolveCompletion;
    const completion = new Promise((resolve) => {
      resolveCompletion = resolve;
    });
    node.mutation = completion;
    return previous
      .then(() => operation())
      .finally(() => resolveCompletion());
  }

  async #child(parent, name) {
    try {
      return await parent.getDirectoryHandle(name);
    } catch (error) {
      if (
        !(error instanceof DOMException) ||
        !["NotFoundError", "TypeMismatchError"].includes(error.name)
      ) {
        opfs_error(error);
      }
    }
    try {
      return await parent.getFileHandle(name);
    } catch (error) {
      if (
        error instanceof DOMException &&
        ["NotFoundError", "TypeMismatchError"].includes(error.name)
      ) {
        return undefined;
      }
      opfs_error(error);
    }
  }

  async lookup(parent, name) {
    const parent_node = this.#as_node(parent);
    const parts = [...parent_node.parts, valid_name(name)];
    // 尚未绑定（或已 detach）时表现为空目录：直接返回 undefined 而非抛错。
    if (!parent_node.handle) {
      this.#forget(parts);
      return undefined;
    }
    const handle = await this.#child(this.#directory(parent), name);
    if (!handle) {
      this.#forget(parts);
      return undefined;
    }
    return this.#remember(parts, handle);
  }

  async getattr(node) {
    const current = this.#as_node(node);
    let size = 0n;
    if (current.handle && current.handle.kind === "file") {
      const file = await opfs_call(current.handle.getFile());
      size = BigInt(file.size);
      if (!current.metadata.mtimeOverride) {
        current.metadata.mtime = {
          seconds: BigInt(Math.floor(file.lastModified / 1000)),
          nanoseconds: (file.lastModified % 1000) * 1_000_000,
        };
      }
    }
    return {
      mode: current.metadata.mode,
      size,
      nlink: current.handle && current.handle.kind === "directory" ? 2 : 1,
      uid: current.metadata.uid,
      gid: current.metadata.gid,
      blockSize: 4096,
      atime: current.metadata.atime,
      mtime: current.metadata.mtime,
      ctime: current.metadata.ctime,
    };
  }

  async setattr(node, changes) {
    const current = this.#as_node(node);
    return await this.#mutate(current, async () => {
      this.#as_node(current);
      if (changes.size !== undefined) {
        if (!current.handle || current.handle.kind !== "file") {
          throw new FSError("EISDIR");
        }
        const writable = await opfs_call(
          current.handle.createWritable({ keepExistingData: true }),
        );
        try {
          await opfs_call(writable.truncate(checked_offset(changes.size)));
        } finally {
          await opfs_call(writable.close());
        }
        // 截断改变了底层文件，除非本次 setattr 显式给了 mtime，否则以原生
        // 时间戳为准。
        current.metadata.mtimeOverride = false;
      }
      if (changes.mode !== undefined) {
        current.metadata.mode =
          (current.metadata.mode & 0o170000) | (changes.mode & 0o7777);
      }
      if (changes.uid !== undefined) current.metadata.uid = changes.uid;
      if (changes.gid !== undefined) current.metadata.gid = changes.gid;
      if (changes.atime !== undefined) {
        current.metadata.atime = changes.atime === "now" ? now() : changes.atime;
      }
      if (changes.mtime !== undefined) {
        current.metadata.mtime = changes.mtime === "now" ? now() : changes.mtime;
        current.metadata.mtimeOverride = true;
      }
      if (changes.ctime !== undefined) current.metadata.ctime = changes.ctime;
      else current.metadata.ctime = now();
      return await this.getattr(current);
    });
  }

  async open(node, flags) {
    const current = this.#as_node(node);
    if (!current.handle || current.handle.kind !== "file") {
      throw new FSError("EISDIR");
    }
    if (flags & OpenFlags.TRUNCATE) {
      await this.setattr(current, { size: 0n });
    }
    return new Handle(current);
  }

  async create(parent, name, flags, context) {
    name = valid_name(name);
    const parent_node = this.#as_node(parent);
    const directory = this.#directory(parent);
    const existing = await this.#child(directory, name);
    if (existing) {
      if (flags & OpenFlags.EXCLUSIVE) {
        throw new FSError("EEXIST");
      }
      if (existing.kind !== "file") {
        throw new FSError("EISDIR");
      }
    }
    const file =
      existing ??
      (await opfs_call(directory.getFileHandle(name, { create: true })));
    const node = this.#remember([...parent_node.parts, name], file);
    if (!existing) {
      node.metadata.mode = FileType.file | (context.mode & 0o7777);
      node.metadata.uid = context.uid;
      node.metadata.gid = context.gid;
    }
    if (flags & OpenFlags.TRUNCATE) await this.setattr(node, { size: 0n });
    return { node, handle: new Handle(node) };
  }

  async read(node, handle, offset, length) {
    const current = this.#open_handle(node, handle);
    if (!current.handle || current.handle.kind !== "file") {
      throw new FSError("EISDIR");
    }
    const file = await opfs_call(current.handle.getFile());
    current.metadata.atime = now();
    return new Uint8Array(
      await opfs_call(
        file
          .slice(checked_offset(offset), checked_offset(offset) + length)
          .arrayBuffer(),
      ),
    );
  }

  async write(node, handle, offset, data) {
    const current = this.#open_handle(node, handle);
    return await this.#mutate(current, async () => {
      this.#open_handle(node, handle);
      if (!current.handle || current.handle.kind !== "file") {
        throw new FSError("EISDIR");
      }
      const writable = await opfs_call(
        current.handle.createWritable({ keepExistingData: true }),
      );
      try {
        await opfs_call(writable.seek(checked_offset(offset)));
        const copy = new Uint8Array(data.byteLength);
        copy.set(data);
        await opfs_call(writable.write(copy.buffer));
      } finally {
        await opfs_call(writable.close());
      }
      current.metadata.mtime = now();
      current.metadata.mtimeOverride = false;
      current.metadata.ctime = current.metadata.mtime;
      return data.byteLength;
    });
  }

  // OPFS / FSA 在 writable 关闭时即提交每次写入，所以 write 返回时文件已持久，
  // flush 与 fsync 没有剩余工作要做。
  async flush() { }

  async fsync() { }

  async opendir(node) {
    const current = this.#as_node(node);
    if (current.handle && current.handle.kind !== "directory") {
      throw new FSError("ENOTDIR");
    }
    return new Handle(current);
  }

  async readdir(node, handle) {
    const current = this.#open_handle(node, handle);
    if (!current.handle) return [];
    const result = [];
    for await (const [name, handle] of current.handle.entries()) {
      result.push({
        name,
        node: this.#remember([...current.parts, name], handle),
      });
    }
    return result;
  }

  async mkdir(parent, name, context) {
    name = valid_name(name);
    const parent_node = this.#as_node(parent);
    if (await this.#child(this.#directory(parent), name)) {
      throw new FSError("EEXIST");
    }
    const handle = await opfs_call(
      this.#directory(parent).getDirectoryHandle(name, { create: true }),
    );
    const node = this.#remember([...parent_node.parts, name], handle);
    node.metadata.mode = FileType.directory | (context.mode & 0o7777);
    node.metadata.uid = context.uid;
    node.metadata.gid = context.gid;
    return node;
  }

  async unlink(parent, name) {
    name = valid_name(name);
    const child = await this.lookup(parent, name);
    if (!child) throw new FSError("ENOENT");
    if (this.#as_node(child).handle.kind !== "file") {
      throw new FSError("EISDIR");
    }
    await opfs_call(this.#directory(parent).removeEntry(name));
    this.#forget([...this.#as_node(parent).parts, name]);
  }

  async rmdir(parent, name) {
    name = valid_name(name);
    const child = await this.lookup(parent, name);
    if (!child) throw new FSError("ENOENT");
    if (this.#as_node(child).handle.kind !== "directory") {
      throw new FSError("ENOTDIR");
    }
    await opfs_call(this.#directory(parent).removeEntry(name));
    this.#forget([...this.#as_node(parent).parts, name]);
  }

  async #copy(source, destination, name) {
    // 可移植的 File System 句柄没有原子的递归 rename，也没有命名空间级事务。
    // 只复制到不存在的目标，绝不去删除无关的目标数据。复制失败仍可能留下本次
    // 操作创建的残缺目标。
    if (source.kind === "file") {
      const input = await opfs_call(source.getFile());
      const output = await opfs_call(
        destination.getFileHandle(name, { create: true }),
      );
      const writable = await opfs_call(output.createWritable());
      // pipeTo 在成功后关闭目标，读取源失败时中止目标，且不会把整个文件
      // 物化到内存里。
      await opfs_call(input.stream().pipeTo(writable));
      return output;
    }
    const output = await opfs_call(
      destination.getDirectoryHandle(name, { create: true }),
    );
    for await (const [child_name, child] of source.entries()) {
      await this.#copy(child, output, child_name);
    }
    return output;
  }

  async rename(oldParent, oldName, newParent, newName) {
    oldName = valid_name(oldName);
    newName = valid_name(newName);
    const old_parent = this.#as_node(oldParent);
    const new_parent = this.#as_node(newParent);
    if (old_parent === new_parent && oldName === newName) return;
    const source = await this.lookup(old_parent, oldName);
    if (!source) throw new FSError("ENOENT");
    const source_node = this.#as_node(source);
    const old_parts = [...old_parent.parts, oldName];
    const new_parts = [...new_parent.parts, newName];
    if (
      source_node.handle.kind === "directory" &&
      new_parts.slice(0, old_parts.length).join("/") === old_parts.join("/")
    ) {
      throw new FSError("EINVAL", "cannot move a directory into itself");
    }

    const existing = await this.lookup(new_parent, newName);
    if (existing) {
      throw new FSError(
        "EOPNOTSUPP",
        "browser filesystems cannot atomically replace a rename destination",
      );
    }

    const destination = this.#directory(new_parent);
    const cleanup_destination = () =>
      destination
        .removeEntry(newName, {
          recursive: source_node.handle.kind === "directory",
        })
        .catch(() => { });
    let copied;
    try {
      copied = await this.#copy(source_node.handle, destination, newName);
    } catch (error) {
      await cleanup_destination();
      throw error;
    }
    try {
      await opfs_call(
        this.#directory(old_parent).removeEntry(oldName, {
          recursive: source_node.handle.kind === "directory",
        }),
      );
    } catch (error) {
      await cleanup_destination();
      throw error;
    }

    const moved = [...this.#nodes].filter(
      ([key]) =>
        key === old_parts.join("/") ||
        key.startsWith(`${old_parts.join("/")}/`),
    );
    moved.sort(([, left], [, right]) => left.parts.length - right.parts.length);
    for (const [key, node] of moved) {
      const relative = node.parts.slice(old_parts.length);
      let handle = copied;
      for (const component of relative) {
        if (handle.kind !== "directory") throw new FSError("EIO");
        const child = await this.#child(handle, component);
        if (!child) throw new FSError("EIO");
        handle = child;
      }
      node.handle = handle;
      if (
        key === old_parts.join("/") ||
        key.startsWith(`${old_parts.join("/")}/`)
      ) {
        this.#nodes.delete(key);
        node.parts = [...new_parts, ...node.parts.slice(old_parts.length)];
        this.#nodes.set(node.parts.join("/"), node);
      }
    }
  }

  // ---- 适配本仓库的延迟绑定 / 控制接口 --------------------------------

  async attach(directory) {
    if (!directory || directory.kind !== "directory") {
      throw new TypeError("需要一个 FileSystemDirectoryHandle");
    }
    let readOnly = false;
    if (typeof directory.queryPermission === "function") {
      let permission = await directory.queryPermission({ mode: "readwrite" });
      if (
        permission !== "granted" &&
        typeof directory.requestPermission === "function"
      ) {
        permission = await directory.requestPermission({ mode: "readwrite" });
      }
      readOnly = permission !== "granted";
      if (readOnly && typeof directory.queryPermission === "function") {
        const readable = await directory.queryPermission({ mode: "read" });
        if (readable !== "granted") {
          throw new Error("没有拿到该文件夹的读取权限");
        }
      }
    }
    // 只改 root 节点的 handle，不替换 root 对象（保持 inode 稳定）。
    this.root.handle = directory;
    this.root.attached = true;
    this.root.metadata = default_metadata("directory");
    this.#nodes.clear();
    this.#nodes.set("", this.root);
    this.#attached = true;
    this.#readOnly = readOnly;
    return { name: directory.name, readOnly };
  }

  async detach() {
    // 直写式下数据早已落盘，detach 只是解绑：把 root 的 handle 清空。
    this.root.handle = null;
    this.#nodes.clear();
    this.#nodes.set("", this.root);
    this.#attached = false;
    this.#readOnly = false;
  }

  getState() {
    return {
      attached: this.#attached,
      name: this.#attached && this.root.handle ? this.root.handle.name : "",
      readOnly: this.#readOnly,
      pendingWrites: 0,
    };
  }

  // ---- 上游未实现、但本仓库需要的可选操作 ------------------------------

  statfs() {
    return {
      blocks: 1n << 20n,
      blocksFree: 1n << 19n,
      blocksAvailable: 1n << 19n,
      files: 1n << 20n,
      filesFree: 1n << 19n,
      blockSize: 4096,
      fragmentSize: 4096,
      nameLength: MAX_NAME_BYTES,
    };
  }

  access(node, mask) {
    this.#as_node(node);
    // 只读绑定时，任何需要写入的访问都拒绝。
    if (this.#readOnly && mask & 0o2) {
      throw new FSError("EACCES", "本地目录只读");
    }
  }
}

/** 浏览器是否具备挂载本地目录所需的全部能力。 */
export const HOSTFS_SUPPORTED =
  typeof globalThis.showDirectoryPicker === "function" &&
  typeof globalThis.FileSystemDirectoryHandle === "function";

/**
 * 创建一个「可延迟绑定本地目录」的 virtio-fs 后端。
 *
 * @param {{ onChange?: (state: object) => void }} [options] 预留，当前未使用。
 * @returns 包含 `fs`（交给 fileSystemDevice）、`attach`、`detach`、`flush`、
 *          `getState` 的控制器。
 */
export function createHostDirectoryFS(options = {}) {
  const fs = new BrowserFS();
  return {
    fs,
    attach: (directory) => fs.attach(directory),
    detach: () => fs.detach(),
    getState: () => fs.getState(),
  };
}
