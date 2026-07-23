// ../../../../../private/tmp/vendorbuild/node_modules/tcpip/dist/chunk-T54CGJHW.js
var d = (b2, o) => (o = Symbol[b2]) ? o : /* @__PURE__ */ Symbol.for("Symbol." + b2);
var t = (b2) => {
  throw TypeError(b2);
};
var a = (b2, o, e) => {
  if (o != null) {
    typeof o != "object" && typeof o != "function" && t("Object expected");
    var i, l3;
    e && (i = o[d("asyncDispose")]), i === void 0 && (i = o[d("dispose")], e && (l3 = i)), typeof i != "function" && t("Object not disposable"), l3 && (i = function() {
      try {
        l3.call(this);
      } catch (m3) {
        return Promise.reject(m3);
      }
    }), b2.push([e, i, o]);
  } else e && b2.push([e]);
  return o;
};
var c = (b2, o, e) => {
  var i = typeof SuppressedError == "function" ? SuppressedError : function(s, S2, p, y) {
    return y = Error(p), y.name = "SuppressedError", y.error = s, y.suppressed = S2, y;
  }, l3 = (s) => o = e ? new i(s, o, "An error was suppressed during disposal") : (e = true, s), m3 = (s) => {
    for (; s = b2.pop(); ) try {
      var S2 = s[1] && s[1].call(s[2]);
      if (s[0]) return Promise.resolve(S2).then(m3, (p) => (l3(p), m3()));
    } catch (p) {
      l3(p);
    }
    if (e) throw o;
  };
  return m3();
};
var r = "dispose" in Symbol ? Symbol.dispose : /* @__PURE__ */ Symbol.for("Symbol.dispose");

// ../../../../../private/tmp/vendorbuild/node_modules/@bjorn3/browser_wasi_shim/dist/wasi_defs.js
var CLOCKID_REALTIME = 0;
var CLOCKID_MONOTONIC = 1;
var ERRNO_SUCCESS = 0;
var ERRNO_BADF = 8;
var ERRNO_INVAL = 28;
var ERRNO_NAMETOOLONG = 37;
var ERRNO_NOSYS = 52;
var ERRNO_NOTDIR = 54;
var ERRNO_NOTSUP = 58;
var ERRNO_PERM = 63;
var RIGHTS_FD_DATASYNC = 1 << 0;
var RIGHTS_FD_READ = 1 << 1;
var RIGHTS_FD_SEEK = 1 << 2;
var RIGHTS_FD_FDSTAT_SET_FLAGS = 1 << 3;
var RIGHTS_FD_SYNC = 1 << 4;
var RIGHTS_FD_TELL = 1 << 5;
var RIGHTS_FD_WRITE = 1 << 6;
var RIGHTS_FD_ADVISE = 1 << 7;
var RIGHTS_FD_ALLOCATE = 1 << 8;
var RIGHTS_PATH_CREATE_DIRECTORY = 1 << 9;
var RIGHTS_PATH_CREATE_FILE = 1 << 10;
var RIGHTS_PATH_LINK_SOURCE = 1 << 11;
var RIGHTS_PATH_LINK_TARGET = 1 << 12;
var RIGHTS_PATH_OPEN = 1 << 13;
var RIGHTS_FD_READDIR = 1 << 14;
var RIGHTS_PATH_READLINK = 1 << 15;
var RIGHTS_PATH_RENAME_SOURCE = 1 << 16;
var RIGHTS_PATH_RENAME_TARGET = 1 << 17;
var RIGHTS_PATH_FILESTAT_GET = 1 << 18;
var RIGHTS_PATH_FILESTAT_SET_SIZE = 1 << 19;
var RIGHTS_PATH_FILESTAT_SET_TIMES = 1 << 20;
var RIGHTS_FD_FILESTAT_GET = 1 << 21;
var RIGHTS_FD_FILESTAT_SET_SIZE = 1 << 22;
var RIGHTS_FD_FILESTAT_SET_TIMES = 1 << 23;
var RIGHTS_PATH_SYMLINK = 1 << 24;
var RIGHTS_PATH_REMOVE_DIRECTORY = 1 << 25;
var RIGHTS_PATH_UNLINK_FILE = 1 << 26;
var RIGHTS_POLL_FD_READWRITE = 1 << 27;
var RIGHTS_SOCK_SHUTDOWN = 1 << 28;
var Iovec = class _Iovec {
  static read_bytes(view, ptr) {
    const iovec = new _Iovec();
    iovec.buf = view.getUint32(ptr, true);
    iovec.buf_len = view.getUint32(ptr + 4, true);
    return iovec;
  }
  static read_bytes_array(view, ptr, len) {
    const iovecs = [];
    for (let i = 0; i < len; i++) {
      iovecs.push(_Iovec.read_bytes(view, ptr + 8 * i));
    }
    return iovecs;
  }
};
var Ciovec = class _Ciovec {
  static read_bytes(view, ptr) {
    const iovec = new _Ciovec();
    iovec.buf = view.getUint32(ptr, true);
    iovec.buf_len = view.getUint32(ptr + 4, true);
    return iovec;
  }
  static read_bytes_array(view, ptr, len) {
    const iovecs = [];
    for (let i = 0; i < len; i++) {
      iovecs.push(_Ciovec.read_bytes(view, ptr + 8 * i));
    }
    return iovecs;
  }
};
var WHENCE_SET = 0;
var WHENCE_CUR = 1;
var WHENCE_END = 2;
var FILETYPE_CHARACTER_DEVICE = 2;
var FILETYPE_REGULAR_FILE = 4;
var FDFLAGS_APPEND = 1 << 0;
var FDFLAGS_DSYNC = 1 << 1;
var FDFLAGS_NONBLOCK = 1 << 2;
var FDFLAGS_RSYNC = 1 << 3;
var FDFLAGS_SYNC = 1 << 4;
var Fdstat = class {
  write_bytes(view, ptr) {
    view.setUint8(ptr, this.fs_filetype);
    view.setUint16(ptr + 2, this.fs_flags, true);
    view.setBigUint64(ptr + 8, this.fs_rights_base, true);
    view.setBigUint64(ptr + 16, this.fs_rights_inherited, true);
  }
  constructor(filetype, flags) {
    this.fs_rights_base = 0n;
    this.fs_rights_inherited = 0n;
    this.fs_filetype = filetype;
    this.fs_flags = flags;
  }
};
var FSTFLAGS_ATIM = 1 << 0;
var FSTFLAGS_ATIM_NOW = 1 << 1;
var FSTFLAGS_MTIM = 1 << 2;
var FSTFLAGS_MTIM_NOW = 1 << 3;
var OFLAGS_CREAT = 1 << 0;
var OFLAGS_DIRECTORY = 1 << 1;
var OFLAGS_EXCL = 1 << 2;
var OFLAGS_TRUNC = 1 << 3;
var Filestat = class {
  write_bytes(view, ptr) {
    view.setBigUint64(ptr, this.dev, true);
    view.setBigUint64(ptr + 8, this.ino, true);
    view.setUint8(ptr + 16, this.filetype);
    view.setBigUint64(ptr + 24, this.nlink, true);
    view.setBigUint64(ptr + 32, this.size, true);
    view.setBigUint64(ptr + 38, this.atim, true);
    view.setBigUint64(ptr + 46, this.mtim, true);
    view.setBigUint64(ptr + 52, this.ctim, true);
  }
  constructor(filetype, size) {
    this.dev = 0n;
    this.ino = 0n;
    this.nlink = 0n;
    this.atim = 0n;
    this.mtim = 0n;
    this.ctim = 0n;
    this.filetype = filetype;
    this.size = size;
  }
};
var EVENTRWFLAGS_FD_READWRITE_HANGUP = 1 << 0;
var SUBCLOCKFLAGS_SUBSCRIPTION_CLOCK_ABSTIME = 1 << 0;
var RIFLAGS_RECV_PEEK = 1 << 0;
var RIFLAGS_RECV_WAITALL = 1 << 1;
var ROFLAGS_RECV_DATA_TRUNCATED = 1 << 0;
var SDFLAGS_RD = 1 << 0;
var SDFLAGS_WR = 1 << 1;

// ../../../../../private/tmp/vendorbuild/node_modules/@bjorn3/browser_wasi_shim/dist/debug.js
var Debug = class Debug2 {
  enable(enabled) {
    this.log = createLogger(enabled === void 0 ? true : enabled, this.prefix);
  }
  get enabled() {
    return this.isEnabled;
  }
  constructor(isEnabled) {
    this.isEnabled = isEnabled;
    this.prefix = "wasi:";
    this.enable(isEnabled);
  }
};
function createLogger(enabled, prefix) {
  if (enabled) {
    const a2 = console.log.bind(console, "%c%s", "color: #265BA0", prefix);
    return a2;
  } else {
    return () => {
    };
  }
}
var debug = new Debug(false);

// ../../../../../private/tmp/vendorbuild/node_modules/@bjorn3/browser_wasi_shim/dist/wasi.js
var WASIProcExit = class extends Error {
  constructor(code) {
    super("exit with exit code " + code);
    this.code = code;
  }
};
var WASI = class WASI2 {
  start(instance) {
    this.inst = instance;
    try {
      instance.exports._start();
      return 0;
    } catch (e) {
      if (e instanceof WASIProcExit) {
        return e.code;
      } else {
        throw e;
      }
    }
  }
  initialize(instance) {
    this.inst = instance;
    if (instance.exports._initialize) {
      instance.exports._initialize();
    }
  }
  constructor(args, env, fds, options = {}) {
    this.args = [];
    this.env = [];
    this.fds = [];
    debug.enable(options.debug);
    this.args = args;
    this.env = env;
    this.fds = fds;
    const self = this;
    this.wasiImport = { args_sizes_get(argc, argv_buf_size) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      buffer.setUint32(argc, self.args.length, true);
      let buf_size = 0;
      for (const arg of self.args) {
        buf_size += arg.length + 1;
      }
      buffer.setUint32(argv_buf_size, buf_size, true);
      debug.log(buffer.getUint32(argc, true), buffer.getUint32(argv_buf_size, true));
      return 0;
    }, args_get(argv, argv_buf) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      const orig_argv_buf = argv_buf;
      for (let i = 0; i < self.args.length; i++) {
        buffer.setUint32(argv, argv_buf, true);
        argv += 4;
        const arg = new TextEncoder().encode(self.args[i]);
        buffer8.set(arg, argv_buf);
        buffer.setUint8(argv_buf + arg.length, 0);
        argv_buf += arg.length + 1;
      }
      if (debug.enabled) {
        debug.log(new TextDecoder("utf-8").decode(buffer8.slice(orig_argv_buf, argv_buf)));
      }
      return 0;
    }, environ_sizes_get(environ_count, environ_size) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      buffer.setUint32(environ_count, self.env.length, true);
      let buf_size = 0;
      for (const environ of self.env) {
        buf_size += environ.length + 1;
      }
      buffer.setUint32(environ_size, buf_size, true);
      debug.log(buffer.getUint32(environ_count, true), buffer.getUint32(environ_size, true));
      return 0;
    }, environ_get(environ, environ_buf) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      const orig_environ_buf = environ_buf;
      for (let i = 0; i < self.env.length; i++) {
        buffer.setUint32(environ, environ_buf, true);
        environ += 4;
        const e = new TextEncoder().encode(self.env[i]);
        buffer8.set(e, environ_buf);
        buffer.setUint8(environ_buf + e.length, 0);
        environ_buf += e.length + 1;
      }
      if (debug.enabled) {
        debug.log(new TextDecoder("utf-8").decode(buffer8.slice(orig_environ_buf, environ_buf)));
      }
      return 0;
    }, clock_res_get(id, res_ptr) {
      let resolutionValue;
      switch (id) {
        case CLOCKID_MONOTONIC: {
          resolutionValue = 5000n;
          break;
        }
        case CLOCKID_REALTIME: {
          resolutionValue = 1000000n;
          break;
        }
        default:
          return ERRNO_NOSYS;
      }
      const view = new DataView(self.inst.exports.memory.buffer);
      view.setBigUint64(res_ptr, resolutionValue, true);
      return ERRNO_SUCCESS;
    }, clock_time_get(id, precision, time) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      if (id === CLOCKID_REALTIME) {
        buffer.setBigUint64(time, BigInt((/* @__PURE__ */ new Date()).getTime()) * 1000000n, true);
      } else if (id == CLOCKID_MONOTONIC) {
        let monotonic_time;
        try {
          monotonic_time = BigInt(Math.round(performance.now() * 1e6));
        } catch (e) {
          monotonic_time = 0n;
        }
        buffer.setBigUint64(time, monotonic_time, true);
      } else {
        buffer.setBigUint64(time, 0n, true);
      }
      return 0;
    }, fd_advise(fd, offset, len, advice) {
      if (self.fds[fd] != void 0) {
        return ERRNO_SUCCESS;
      } else {
        return ERRNO_BADF;
      }
    }, fd_allocate(fd, offset, len) {
      if (self.fds[fd] != void 0) {
        return self.fds[fd].fd_allocate(offset, len);
      } else {
        return ERRNO_BADF;
      }
    }, fd_close(fd) {
      if (self.fds[fd] != void 0) {
        const ret = self.fds[fd].fd_close();
        self.fds[fd] = void 0;
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, fd_datasync(fd) {
      if (self.fds[fd] != void 0) {
        return self.fds[fd].fd_sync();
      } else {
        return ERRNO_BADF;
      }
    }, fd_fdstat_get(fd, fdstat_ptr) {
      if (self.fds[fd] != void 0) {
        const { ret, fdstat } = self.fds[fd].fd_fdstat_get();
        if (fdstat != null) {
          fdstat.write_bytes(new DataView(self.inst.exports.memory.buffer), fdstat_ptr);
        }
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, fd_fdstat_set_flags(fd, flags) {
      if (self.fds[fd] != void 0) {
        return self.fds[fd].fd_fdstat_set_flags(flags);
      } else {
        return ERRNO_BADF;
      }
    }, fd_fdstat_set_rights(fd, fs_rights_base, fs_rights_inheriting) {
      if (self.fds[fd] != void 0) {
        return self.fds[fd].fd_fdstat_set_rights(fs_rights_base, fs_rights_inheriting);
      } else {
        return ERRNO_BADF;
      }
    }, fd_filestat_get(fd, filestat_ptr) {
      if (self.fds[fd] != void 0) {
        const { ret, filestat } = self.fds[fd].fd_filestat_get();
        if (filestat != null) {
          filestat.write_bytes(new DataView(self.inst.exports.memory.buffer), filestat_ptr);
        }
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, fd_filestat_set_size(fd, size) {
      if (self.fds[fd] != void 0) {
        return self.fds[fd].fd_filestat_set_size(size);
      } else {
        return ERRNO_BADF;
      }
    }, fd_filestat_set_times(fd, atim, mtim, fst_flags) {
      if (self.fds[fd] != void 0) {
        return self.fds[fd].fd_filestat_set_times(atim, mtim, fst_flags);
      } else {
        return ERRNO_BADF;
      }
    }, fd_pread(fd, iovs_ptr, iovs_len, offset, nread_ptr) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const iovecs = Iovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
        let nread = 0;
        for (const iovec of iovecs) {
          const { ret, data } = self.fds[fd].fd_pread(iovec.buf_len, offset);
          if (ret != ERRNO_SUCCESS) {
            buffer.setUint32(nread_ptr, nread, true);
            return ret;
          }
          buffer8.set(data, iovec.buf);
          nread += data.length;
          offset += BigInt(data.length);
          if (data.length != iovec.buf_len) {
            break;
          }
        }
        buffer.setUint32(nread_ptr, nread, true);
        return ERRNO_SUCCESS;
      } else {
        return ERRNO_BADF;
      }
    }, fd_prestat_get(fd, buf_ptr) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const { ret, prestat } = self.fds[fd].fd_prestat_get();
        if (prestat != null) {
          prestat.write_bytes(buffer, buf_ptr);
        }
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, fd_prestat_dir_name(fd, path_ptr, path_len) {
      if (self.fds[fd] != void 0) {
        const { ret, prestat } = self.fds[fd].fd_prestat_get();
        if (prestat == null) {
          return ret;
        }
        const prestat_dir_name = prestat.inner.pr_name;
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        buffer8.set(prestat_dir_name.slice(0, path_len), path_ptr);
        return prestat_dir_name.byteLength > path_len ? ERRNO_NAMETOOLONG : ERRNO_SUCCESS;
      } else {
        return ERRNO_BADF;
      }
    }, fd_pwrite(fd, iovs_ptr, iovs_len, offset, nwritten_ptr) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
        let nwritten = 0;
        for (const iovec of iovecs) {
          const data = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len);
          const { ret, nwritten: nwritten_part } = self.fds[fd].fd_pwrite(data, offset);
          if (ret != ERRNO_SUCCESS) {
            buffer.setUint32(nwritten_ptr, nwritten, true);
            return ret;
          }
          nwritten += nwritten_part;
          offset += BigInt(nwritten_part);
          if (nwritten_part != data.byteLength) {
            break;
          }
        }
        buffer.setUint32(nwritten_ptr, nwritten, true);
        return ERRNO_SUCCESS;
      } else {
        return ERRNO_BADF;
      }
    }, fd_read(fd, iovs_ptr, iovs_len, nread_ptr) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const iovecs = Iovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
        let nread = 0;
        for (const iovec of iovecs) {
          const { ret, data } = self.fds[fd].fd_read(iovec.buf_len);
          if (ret != ERRNO_SUCCESS) {
            buffer.setUint32(nread_ptr, nread, true);
            return ret;
          }
          buffer8.set(data, iovec.buf);
          nread += data.length;
          if (data.length != iovec.buf_len) {
            break;
          }
        }
        buffer.setUint32(nread_ptr, nread, true);
        return ERRNO_SUCCESS;
      } else {
        return ERRNO_BADF;
      }
    }, fd_readdir(fd, buf, buf_len, cookie, bufused_ptr) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        let bufused = 0;
        while (true) {
          const { ret, dirent } = self.fds[fd].fd_readdir_single(cookie);
          if (ret != 0) {
            buffer.setUint32(bufused_ptr, bufused, true);
            return ret;
          }
          if (dirent == null) {
            break;
          }
          if (buf_len - bufused < dirent.head_length()) {
            bufused = buf_len;
            break;
          }
          const head_bytes = new ArrayBuffer(dirent.head_length());
          dirent.write_head_bytes(new DataView(head_bytes), 0);
          buffer8.set(new Uint8Array(head_bytes).slice(0, Math.min(head_bytes.byteLength, buf_len - bufused)), buf);
          buf += dirent.head_length();
          bufused += dirent.head_length();
          if (buf_len - bufused < dirent.name_length()) {
            bufused = buf_len;
            break;
          }
          dirent.write_name_bytes(buffer8, buf, buf_len - bufused);
          buf += dirent.name_length();
          bufused += dirent.name_length();
          cookie = dirent.d_next;
        }
        buffer.setUint32(bufused_ptr, bufused, true);
        return 0;
      } else {
        return ERRNO_BADF;
      }
    }, fd_renumber(fd, to) {
      if (self.fds[fd] != void 0 && self.fds[to] != void 0) {
        const ret = self.fds[to].fd_close();
        if (ret != 0) {
          return ret;
        }
        self.fds[to] = self.fds[fd];
        self.fds[fd] = void 0;
        return 0;
      } else {
        return ERRNO_BADF;
      }
    }, fd_seek(fd, offset, whence, offset_out_ptr) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const { ret, offset: offset_out } = self.fds[fd].fd_seek(offset, whence);
        buffer.setBigInt64(offset_out_ptr, offset_out, true);
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, fd_sync(fd) {
      if (self.fds[fd] != void 0) {
        return self.fds[fd].fd_sync();
      } else {
        return ERRNO_BADF;
      }
    }, fd_tell(fd, offset_ptr) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const { ret, offset } = self.fds[fd].fd_tell();
        buffer.setBigUint64(offset_ptr, offset, true);
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, fd_write(fd, iovs_ptr, iovs_len, nwritten_ptr) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
        let nwritten = 0;
        for (const iovec of iovecs) {
          const data = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len);
          const { ret, nwritten: nwritten_part } = self.fds[fd].fd_write(data);
          if (ret != ERRNO_SUCCESS) {
            buffer.setUint32(nwritten_ptr, nwritten, true);
            return ret;
          }
          nwritten += nwritten_part;
          if (nwritten_part != data.byteLength) {
            break;
          }
        }
        buffer.setUint32(nwritten_ptr, nwritten, true);
        return ERRNO_SUCCESS;
      } else {
        return ERRNO_BADF;
      }
    }, path_create_directory(fd, path_ptr, path_len) {
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        return self.fds[fd].path_create_directory(path);
      } else {
        return ERRNO_BADF;
      }
    }, path_filestat_get(fd, flags, path_ptr, path_len, filestat_ptr) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        const { ret, filestat } = self.fds[fd].path_filestat_get(flags, path);
        if (filestat != null) {
          filestat.write_bytes(buffer, filestat_ptr);
        }
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, path_filestat_set_times(fd, flags, path_ptr, path_len, atim, mtim, fst_flags) {
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        return self.fds[fd].path_filestat_set_times(flags, path, atim, mtim, fst_flags);
      } else {
        return ERRNO_BADF;
      }
    }, path_link(old_fd, old_flags, old_path_ptr, old_path_len, new_fd, new_path_ptr, new_path_len) {
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[old_fd] != void 0 && self.fds[new_fd] != void 0) {
        const old_path = new TextDecoder("utf-8").decode(buffer8.slice(old_path_ptr, old_path_ptr + old_path_len));
        const new_path = new TextDecoder("utf-8").decode(buffer8.slice(new_path_ptr, new_path_ptr + new_path_len));
        const { ret, inode_obj } = self.fds[old_fd].path_lookup(old_path, old_flags);
        if (inode_obj == null) {
          return ret;
        }
        return self.fds[new_fd].path_link(new_path, inode_obj, false);
      } else {
        return ERRNO_BADF;
      }
    }, path_open(fd, dirflags, path_ptr, path_len, oflags, fs_rights_base, fs_rights_inheriting, fd_flags, opened_fd_ptr) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        debug.log(path);
        const { ret, fd_obj } = self.fds[fd].path_open(dirflags, path, oflags, fs_rights_base, fs_rights_inheriting, fd_flags);
        if (ret != 0) {
          return ret;
        }
        self.fds.push(fd_obj);
        const opened_fd = self.fds.length - 1;
        buffer.setUint32(opened_fd_ptr, opened_fd, true);
        return 0;
      } else {
        return ERRNO_BADF;
      }
    }, path_readlink(fd, path_ptr, path_len, buf_ptr, buf_len, nread_ptr) {
      const buffer = new DataView(self.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        debug.log(path);
        const { ret, data } = self.fds[fd].path_readlink(path);
        if (data != null) {
          const data_buf = new TextEncoder().encode(data);
          if (data_buf.length > buf_len) {
            buffer.setUint32(nread_ptr, 0, true);
            return ERRNO_BADF;
          }
          buffer8.set(data_buf, buf_ptr);
          buffer.setUint32(nread_ptr, data_buf.length, true);
        }
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, path_remove_directory(fd, path_ptr, path_len) {
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        return self.fds[fd].path_remove_directory(path);
      } else {
        return ERRNO_BADF;
      }
    }, path_rename(fd, old_path_ptr, old_path_len, new_fd, new_path_ptr, new_path_len) {
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0 && self.fds[new_fd] != void 0) {
        const old_path = new TextDecoder("utf-8").decode(buffer8.slice(old_path_ptr, old_path_ptr + old_path_len));
        const new_path = new TextDecoder("utf-8").decode(buffer8.slice(new_path_ptr, new_path_ptr + new_path_len));
        let { ret, inode_obj } = self.fds[fd].path_unlink(old_path);
        if (inode_obj == null) {
          return ret;
        }
        ret = self.fds[new_fd].path_link(new_path, inode_obj, true);
        if (ret != ERRNO_SUCCESS) {
          if (self.fds[fd].path_link(old_path, inode_obj, true) != ERRNO_SUCCESS) {
            throw "path_link should always return success when relinking an inode back to the original place";
          }
        }
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, path_symlink(old_path_ptr, old_path_len, fd, new_path_ptr, new_path_len) {
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const old_path = new TextDecoder("utf-8").decode(buffer8.slice(old_path_ptr, old_path_ptr + old_path_len));
        const new_path = new TextDecoder("utf-8").decode(buffer8.slice(new_path_ptr, new_path_ptr + new_path_len));
        return ERRNO_NOTSUP;
      } else {
        return ERRNO_BADF;
      }
    }, path_unlink_file(fd, path_ptr, path_len) {
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      if (self.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        return self.fds[fd].path_unlink_file(path);
      } else {
        return ERRNO_BADF;
      }
    }, poll_oneoff(in_, out, nsubscriptions) {
      throw "async io not supported";
    }, proc_exit(exit_code) {
      throw new WASIProcExit(exit_code);
    }, proc_raise(sig) {
      throw "raised signal " + sig;
    }, sched_yield() {
    }, random_get(buf, buf_len) {
      const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
      for (let i = 0; i < buf_len; i++) {
        buffer8[buf + i] = Math.random() * 256 | 0;
      }
    }, sock_recv(fd, ri_data, ri_flags) {
      throw "sockets not supported";
    }, sock_send(fd, si_data, si_flags) {
      throw "sockets not supported";
    }, sock_shutdown(fd, how) {
      throw "sockets not supported";
    }, sock_accept(fd, flags) {
      throw "sockets not supported";
    } };
  }
};

// ../../../../../private/tmp/vendorbuild/node_modules/@bjorn3/browser_wasi_shim/dist/fd.js
var Fd = class {
  fd_allocate(offset, len) {
    return ERRNO_NOTSUP;
  }
  fd_close() {
    return 0;
  }
  fd_fdstat_get() {
    return { ret: ERRNO_NOTSUP, fdstat: null };
  }
  fd_fdstat_set_flags(flags) {
    return ERRNO_NOTSUP;
  }
  fd_fdstat_set_rights(fs_rights_base, fs_rights_inheriting) {
    return ERRNO_NOTSUP;
  }
  fd_filestat_get() {
    return { ret: ERRNO_NOTSUP, filestat: null };
  }
  fd_filestat_set_size(size) {
    return ERRNO_NOTSUP;
  }
  fd_filestat_set_times(atim, mtim, fst_flags) {
    return ERRNO_NOTSUP;
  }
  fd_pread(size, offset) {
    return { ret: ERRNO_NOTSUP, data: new Uint8Array() };
  }
  fd_prestat_get() {
    return { ret: ERRNO_NOTSUP, prestat: null };
  }
  fd_pwrite(data, offset) {
    return { ret: ERRNO_NOTSUP, nwritten: 0 };
  }
  fd_read(size) {
    return { ret: ERRNO_NOTSUP, data: new Uint8Array() };
  }
  fd_readdir_single(cookie) {
    return { ret: ERRNO_NOTSUP, dirent: null };
  }
  fd_seek(offset, whence) {
    return { ret: ERRNO_NOTSUP, offset: 0n };
  }
  fd_sync() {
    return 0;
  }
  fd_tell() {
    return { ret: ERRNO_NOTSUP, offset: 0n };
  }
  fd_write(data) {
    return { ret: ERRNO_NOTSUP, nwritten: 0 };
  }
  path_create_directory(path) {
    return ERRNO_NOTSUP;
  }
  path_filestat_get(flags, path) {
    return { ret: ERRNO_NOTSUP, filestat: null };
  }
  path_filestat_set_times(flags, path, atim, mtim, fst_flags) {
    return ERRNO_NOTSUP;
  }
  path_link(path, inode, allow_dir) {
    return ERRNO_NOTSUP;
  }
  path_unlink(path) {
    return { ret: ERRNO_NOTSUP, inode_obj: null };
  }
  path_lookup(path, dirflags) {
    return { ret: ERRNO_NOTSUP, inode_obj: null };
  }
  path_open(dirflags, path, oflags, fs_rights_base, fs_rights_inheriting, fd_flags) {
    return { ret: ERRNO_NOTDIR, fd_obj: null };
  }
  path_readlink(path) {
    return { ret: ERRNO_NOTSUP, data: null };
  }
  path_remove_directory(path) {
    return ERRNO_NOTSUP;
  }
  path_rename(old_path, new_fd, new_path) {
    return ERRNO_NOTSUP;
  }
  path_unlink_file(path) {
    return ERRNO_NOTSUP;
  }
};
var Inode = class {
};

// ../../../../../private/tmp/vendorbuild/node_modules/@bjorn3/browser_wasi_shim/dist/fs_mem.js
var OpenFile = class extends Fd {
  fd_allocate(offset, len) {
    if (this.file.size > offset + len) {
    } else {
      const new_data = new Uint8Array(Number(offset + len));
      new_data.set(this.file.data, 0);
      this.file.data = new_data;
    }
    return ERRNO_SUCCESS;
  }
  fd_fdstat_get() {
    return { ret: 0, fdstat: new Fdstat(FILETYPE_REGULAR_FILE, 0) };
  }
  fd_filestat_set_size(size) {
    if (this.file.size > size) {
      this.file.data = new Uint8Array(this.file.data.buffer.slice(0, Number(size)));
    } else {
      const new_data = new Uint8Array(Number(size));
      new_data.set(this.file.data, 0);
      this.file.data = new_data;
    }
    return ERRNO_SUCCESS;
  }
  fd_read(size) {
    const slice = this.file.data.slice(Number(this.file_pos), Number(this.file_pos + BigInt(size)));
    this.file_pos += BigInt(slice.length);
    return { ret: 0, data: slice };
  }
  fd_pread(size, offset) {
    const slice = this.file.data.slice(Number(offset), Number(offset + BigInt(size)));
    return { ret: 0, data: slice };
  }
  fd_seek(offset, whence) {
    let calculated_offset;
    switch (whence) {
      case WHENCE_SET:
        calculated_offset = offset;
        break;
      case WHENCE_CUR:
        calculated_offset = this.file_pos + offset;
        break;
      case WHENCE_END:
        calculated_offset = BigInt(this.file.data.byteLength) + offset;
        break;
      default:
        return { ret: ERRNO_INVAL, offset: 0n };
    }
    if (calculated_offset < 0) {
      return { ret: ERRNO_INVAL, offset: 0n };
    }
    this.file_pos = calculated_offset;
    return { ret: 0, offset: this.file_pos };
  }
  fd_tell() {
    return { ret: 0, offset: this.file_pos };
  }
  fd_write(data) {
    if (this.file.readonly) return { ret: ERRNO_BADF, nwritten: 0 };
    if (this.file_pos + BigInt(data.byteLength) > this.file.size) {
      const old = this.file.data;
      this.file.data = new Uint8Array(Number(this.file_pos + BigInt(data.byteLength)));
      this.file.data.set(old);
    }
    this.file.data.set(data, Number(this.file_pos));
    this.file_pos += BigInt(data.byteLength);
    return { ret: 0, nwritten: data.byteLength };
  }
  fd_pwrite(data, offset) {
    if (this.file.readonly) return { ret: ERRNO_BADF, nwritten: 0 };
    if (offset + BigInt(data.byteLength) > this.file.size) {
      const old = this.file.data;
      this.file.data = new Uint8Array(Number(offset + BigInt(data.byteLength)));
      this.file.data.set(old);
    }
    this.file.data.set(data, Number(offset));
    return { ret: 0, nwritten: data.byteLength };
  }
  fd_filestat_get() {
    return { ret: 0, filestat: this.file.stat() };
  }
  constructor(file) {
    super();
    this.file_pos = 0n;
    this.file = file;
  }
};
var File = class extends Inode {
  path_open(oflags, fs_rights_base, fd_flags) {
    if (this.readonly && (fs_rights_base & BigInt(RIGHTS_FD_WRITE)) == BigInt(RIGHTS_FD_WRITE)) {
      return { ret: ERRNO_PERM, fd_obj: null };
    }
    if ((oflags & OFLAGS_TRUNC) == OFLAGS_TRUNC) {
      if (this.readonly) return { ret: ERRNO_PERM, fd_obj: null };
      this.data = new Uint8Array([]);
    }
    const file = new OpenFile(this);
    if (fd_flags & FDFLAGS_APPEND) file.fd_seek(0n, WHENCE_END);
    return { ret: ERRNO_SUCCESS, fd_obj: file };
  }
  get size() {
    return BigInt(this.data.byteLength);
  }
  stat() {
    return new Filestat(FILETYPE_REGULAR_FILE, this.size);
  }
  constructor(data, options) {
    super();
    this.data = new Uint8Array(data);
    this.readonly = !!options?.readonly;
  }
};
var ConsoleStdout = class _ConsoleStdout extends Fd {
  fd_filestat_get() {
    const filestat = new Filestat(FILETYPE_CHARACTER_DEVICE, BigInt(0));
    return { ret: 0, filestat };
  }
  fd_fdstat_get() {
    const fdstat = new Fdstat(FILETYPE_CHARACTER_DEVICE, 0);
    fdstat.fs_rights_base = BigInt(RIGHTS_FD_WRITE);
    return { ret: 0, fdstat };
  }
  fd_write(data) {
    this.write(data);
    return { ret: 0, nwritten: data.byteLength };
  }
  static lineBuffered(write) {
    const dec = new TextDecoder("utf-8", { fatal: false });
    let line_buf = "";
    return new _ConsoleStdout((buffer) => {
      line_buf += dec.decode(buffer, { stream: true });
      const lines = line_buf.split("\n");
      for (const [i, line] of lines.entries()) {
        if (i < lines.length - 1) {
          write(line);
        } else {
          line_buf = line;
        }
      }
    });
  }
  constructor(write) {
    super();
    this.write = write;
  }
};

// ../../../../../private/tmp/vendorbuild/node_modules/@tcpip/transport/dist/index.js
function c2(e, r2) {
  let a2 = e.getReader();
  return m(a2, r2);
}
async function* m(e, r2) {
  try {
    for (; ; ) {
      let { done: a2, value: n } = await e.read();
      if (a2) return n;
      yield n;
    }
  } finally {
    r2?.preventCancel || await e.cancel(), e.releaseLock();
  }
}

// ../../../../../private/tmp/vendorbuild/node_modules/@tcpip/wire/dist/index.js
function k(e) {
  if (e.length === 0) throw new Error("empty string");
  let t2 = 0;
  for (let r2 = 0; r2 < e.length; r2++) {
    let n = e.charCodeAt(r2);
    if (n < 48 || n > 57) throw new Error("invalid character");
    t2 = t2 * 10 + (n - 48);
  }
  return t2;
}
function M(e) {
  let t2 = 0;
  for (let r2 = 0; r2 < e.length; r2++) {
    let n = e.charCodeAt(r2), o;
    if (n >= 48 && n <= 57) o = n - 48;
    else if (n >= 97 && n <= 102) o = n - 87;
    else if (n >= 65 && n <= 70) o = n - 55;
    else throw new Error("invalid hex character");
    t2 = t2 << 4 | o;
  }
  return t2;
}
var H = 8;
var w = 20;
function P(e) {
  if (e.length !== 4) throw new Error("invalid ipv4 address");
  return e.join(".");
}
function u(e) {
  let t2 = e.split("."), r2 = new Uint8Array(4);
  if (t2.length !== 4) throw new Error("invalid ipv4 address");
  for (let n = 0; n < 4; n++) {
    let o = t2[n];
    if (o.length === 0) throw new Error(`invalid ipv4 address: empty octet at position ${n}`);
    if (o.length > 3) throw new Error(`invalid ipv4 address: octet too long at position ${n}`);
    let s = k(o);
    if (s > 255) throw new Error(`invalid ipv4 address: octet too large at position ${n}`);
    r2[n] = s;
  }
  return r2;
}
function we(e) {
  let [t2, r2] = e.split("/");
  if (!t2 || !r2) throw new Error("invalid cidr");
  let n = Number.parseInt(r2, 10), o = q(n);
  return { ipAddress: u(t2), netmask: o };
}
function q(e) {
  let t2 = new Uint8Array(4);
  for (let r2 = 0; r2 < e; r2++) {
    let n = Math.floor(r2 / 8), o = 7 - r2 % 8, s = t2[n];
    if (s === void 0) throw new Error("invalid mask size");
    t2[n] = s | 1 << o;
  }
  return t2;
}
function U(e) {
  if (e.length !== 6) throw new Error("invalid mac address");
  return Array.from(e).map((t2) => t2.toString(16).padStart(2, "0")).join(":");
}
function v(e) {
  let t2 = e.split(":");
  if (t2.length !== 6) throw new Error("invalid mac address");
  return new Uint8Array(t2.map((r2) => {
    let n = Number.parseInt(r2, 16);
    if (Number.isNaN(n)) throw new Error("invalid mac address");
    return n;
  }));
}
function ve() {
  let e = new Uint8Array(6);
  return crypto.getRandomValues(e), e[0] = e[0] & 252 | 2, e;
}
function Me(e) {
  if (e.length !== 16) throw new Error("invalid ipv6 address");
  return e.reduce((t2, r2) => t2 + r2.toString(16).padStart(2, "0"), "").match(/.{1,4}/g).join(":");
}
function ze(e) {
  let r2 = te(e).split(":"), n = new Uint8Array(16);
  if (r2.length !== 8) throw new Error("invalid ipv6 address");
  for (let o = 0; o < 8; o++) {
    let s = r2[o];
    if (s.length === 0) throw new Error(`invalid ipv6 address: empty group at position ${o}`);
    if (s.length > 4) throw new Error(`invalid ipv6 address: group too long at position ${o}`);
    let i = M(s);
    if (i > 65535) throw new Error(`invalid ipv6 address: group value too large at position ${o}`);
    n[o * 2] = i >> 8, n[o * 2 + 1] = i & 255;
  }
  return n;
}
function De(e) {
  let r2 = e.toLowerCase().split(":").map((a2) => a2.replace(/^0+(?=\w)/, "")), n = -1, o = 0, s = -1, i = 0;
  for (let a2 = 0; a2 < r2.length; a2++) r2[a2] === "0" || r2[a2] === "" ? (s === -1 && (s = a2), i++, i > o && (n = s, o = i)) : (s = -1, i = 0);
  return o >= 2 && (r2.splice(n, o), n === 0 ? r2.unshift("", "") : n === r2.length ? r2.push("", "") : r2.splice(n, 0, "")), r2.join(":");
}
function te(e) {
  if (!e) throw new Error(`invalid IPv6 address: ${e}`);
  let t2 = e.split("::").map((a2) => a2.split(":"));
  if (t2.length > 2) throw new Error(`invalid IPv6 address: ${e}`);
  let [r2, n] = t2;
  if (!r2) throw new Error(`invalid IPv6 address: ${e}`);
  if (!n) return r2.map((a2) => a2.padStart(4, "0")).join(":");
  let s = 8 - (r2.length + n.length), i = Array(s).fill("0000");
  return [...r2, ...i, ...n].map((a2) => a2.padStart(4, "0")).join(":");
}

// ../../../../../private/tmp/vendorbuild/node_modules/@tcpip/dns/dist/index.js
function R(e) {
  let t2 = e.split(".");
  if (t2.length === 4) return `${t2.reverse().join(".")}.in-addr.arpa`;
  let n = te(e), s = ze(n);
  return `${Array.from(s).flatMap((o) => [o >> 4, o & 15].map((i) => i.toString(16))).reverse().join(".")}.ip6.arpa`;
}
var l = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, ANY: 255 };
var d2 = { IN: 1 };
var w2 = { QUERY: 0, IQUERY: 1, STATUS: 2, NOTIFY: 4, UPDATE: 5 };
var h = { NOERROR: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, NOTIMP: 4, REFUSED: 5 };
function v2(e, t2) {
  let n = [], s = t2;
  for (; ; ) {
    let r2 = e[s];
    if (r2 === void 0 || r2 === 0) break;
    s++;
    let o = new TextDecoder().decode(e.slice(s, s + r2));
    n.push(o), s += r2;
  }
  return [n.join("."), s + 1];
}
function C(e) {
  let t2 = e.split("."), n = new Uint8Array(e.length + 2), s = 0;
  if (e !== "") for (let r2 of t2) {
    n[s] = r2.length, s++;
    for (let o = 0; o < r2.length; o++) n[s + o] = r2.charCodeAt(o);
    s += r2.length;
  }
  return n[s] = 0, n.slice(0, s + 1);
}
function T(e) {
  let [t2] = Object.entries(l).find(([, n]) => n === e) ?? [];
  if (!t2) throw new Error(`unknown dns type: ${e}`);
  return t2;
}
function O(e) {
  if (!(e in l)) throw new Error(`unknown dns type: ${e}`);
  return l[e];
}
function E(e) {
  let [t2] = Object.entries(d2).find(([, n]) => n === e) ?? [];
  if (!t2) throw new Error(`unknown dns class: ${e}`);
  return t2;
}
function b(e) {
  if (!(e in d2)) throw new Error(`unknown dns class: ${e}`);
  return d2[e];
}
function H2(e) {
  let [t2] = Object.entries(w2).find(([, n]) => n === e) ?? [];
  if (!t2) throw new Error(`unknown dns opcode: ${e}`);
  return t2;
}
function V(e) {
  if (!(e in w2)) throw new Error(`unknown dns opcode: ${e}`);
  return w2[e];
}
function Q(e) {
  let [t2] = Object.entries(h).find(([, n]) => n === e) ?? [];
  if (!t2) throw new Error(`unknown dns rcode: ${e}`);
  return t2;
}
function B(e) {
  if (!(e in h)) throw new Error(`unknown dns rcode: ${e}`);
  return h[e];
}
function F(e, t2) {
  let [n, s] = v2(e, t2), r2 = new DataView(e.buffer), o = T(r2.getUint16(s)), i = E(r2.getUint16(s + 2));
  return [{ name: n, type: o, class: i }, s + 4];
}
function L(e) {
  let t2 = C(e.name), n = new Uint8Array(t2.length + 4), s = new DataView(n.buffer), r2 = 0;
  return n.set(t2, r2), r2 += t2.length, s.setUint16(r2, O(e.type)), s.setUint16(r2 + 2, b(e.class)), n;
}
function X(e, t2, n) {
  let s = [], r2 = t2, o = t2 + n;
  for (; r2 < o; ) {
    let i = e[r2];
    if (i === void 0) break;
    r2++;
    let p = new TextDecoder().decode(e.slice(r2, r2 + i));
    s.push(p), r2 += i;
  }
  return [s.join(""), r2];
}
function Y(e) {
  if (e.length === 0) return new Uint8Array([0]);
  let n = new TextEncoder().encode(e), s = [];
  for (let p = 0; p < n.length; p += 255) s.push(n.slice(p, Math.min(p + 255, n.length)));
  let r2 = s.reduce((p, c3) => p + 1 + c3.length, 0), o = new Uint8Array(r2), i = 0;
  for (let p of s) o[i] = p.length, o.set(p, i + 1), i += 1 + p.length;
  return o;
}
function x(e, t2) {
  let [n, s] = v2(e, t2), r2 = new DataView(e.buffer), o = T(r2.getUint16(s)), i = E(r2.getUint16(s + 2)), p = r2.getUint32(s + 4), c3 = r2.getUint16(s + 8), a2 = s + 10;
  switch (o) {
    case "A": {
      let u2 = P(e.slice(a2, a2 + c3)), f = a2 + c3;
      return [{ name: n, class: i, ttl: p, type: o, ip: u2 }, f];
    }
    case "AAAA": {
      let u2 = Me(e.slice(a2, a2 + c3)), f = De(u2), U3 = a2 + c3;
      return [{ name: n, class: i, ttl: p, type: o, ip: f }, U3];
    }
    case "TXT": {
      let [u2, f] = X(e, a2, c3);
      return [{ name: n, class: i, ttl: p, type: o, value: u2 }, f];
    }
    case "PTR": {
      let [u2, f] = v2(e, a2);
      return [{ name: n, class: i, ttl: p, type: o, ptr: u2 }, f];
    }
    default:
      throw new Error(`unsupported record type: ${o}`);
  }
}
function W(e) {
  switch (e.type) {
    case "A":
      return u(e.ip);
    case "AAAA":
      return ze(te(e.ip));
    case "TXT":
      return Y(e.value);
    case "PTR":
      return C(e.ptr);
    default:
      throw new Error("unsupported record type");
  }
}
function A(e) {
  let n = C(e.name), s = W(e), r2 = new Uint8Array(n.length + 10 + s.length), o = new DataView(r2.buffer), i = 0;
  return r2.set(n, i), i += n.length, o.setUint16(i, O(e.type)), o.setUint16(i + 2, b(e.class)), o.setUint32(i + 4, e.ttl), o.setUint16(i + 8, s.length), i += 10, r2.set(s, i), r2;
}
function G(e) {
  if (e.length < 12) throw new Error("DNS header is too short");
  let t2 = new DataView(e.buffer);
  return [{ id: t2.getUint16(0), isResponse: !!(e[2] & 128), opcode: H2(e[2] >> 3 & 15), isAuthoritativeAnswer: !!(e[2] & 4), isTruncated: !!(e[2] & 2), isRecursionDesired: !!(e[2] & 1), isRecursionAvailable: !!(e[3] & 128), rcode: Q(e[3] & 15), questionCount: t2.getUint16(4), answerCount: t2.getUint16(6), authorityCount: t2.getUint16(8), additionalCount: t2.getUint16(10) }, 12];
}
function _(e) {
  let t2 = new Uint8Array(12), n = new DataView(t2.buffer);
  return n.setUint16(0, e.id), t2[2] = (e.isResponse ? 128 : 0) | (V(e.opcode) & 15) << 3 | (e.isAuthoritativeAnswer ? 4 : 0) | (e.isTruncated ? 2 : 0) | (e.isRecursionDesired ? 1 : 0), t2[3] = (e.isRecursionAvailable ? 128 : 0) | B(e.rcode) & 15, n.setUint16(4, e.questionCount), n.setUint16(6, e.answerCount), n.setUint16(8, e.authorityCount), n.setUint16(10, e.additionalCount), t2;
}
function D(e) {
  if (e.length < 12) throw new Error("DNS message is too short");
  let t2 = 0, [n, s] = G(e);
  t2 = s;
  let r2 = [];
  for (let c3 = 0; c3 < n.questionCount; c3++) {
    let [a2, u2] = F(e, t2);
    r2.push(a2), t2 = u2;
  }
  let o = [];
  for (let c3 = 0; c3 < n.answerCount; c3++) {
    let [a2, u2] = x(e, t2);
    o.push(a2), t2 = u2;
  }
  let i = [];
  for (let c3 = 0; c3 < n.authorityCount; c3++) {
    let [a2, u2] = x(e, t2);
    i.push(a2), t2 = u2;
  }
  let p = [];
  for (let c3 = 0; c3 < n.additionalCount; c3++) {
    let [a2, u2] = x(e, t2);
    p.push(a2), t2 = u2;
  }
  return { header: n, questions: r2, answers: o, authorities: i, additionals: p };
}
function m2(e) {
  e.header.questionCount = e.questions.length, e.header.answerCount = e.answers?.length ?? 0, e.header.authorityCount = e.authorities?.length ?? 0, e.header.additionalCount = e.additionals?.length ?? 0;
  let t2 = _(e.header), n = e.questions.map(L), s = e.answers?.map(A) ?? [], r2 = e.authorities?.map(A) ?? [], o = e.additionals?.map(A) ?? [], i = t2.length;
  for (let a2 of n) i += a2.length;
  for (let a2 of s) i += a2.length;
  for (let a2 of r2) i += a2.length;
  for (let a2 of o) i += a2.length;
  let p = new Uint8Array(i), c3 = 0;
  p.set(t2, c3), c3 += t2.length;
  for (let a2 of n) p.set(a2, c3), c3 += a2.length;
  for (let a2 of s) p.set(a2, c3), c3 += a2.length;
  for (let a2 of r2) p.set(a2, c3), c3 += a2.length;
  for (let a2 of o) p.set(a2, c3), c3 += a2.length;
  return p;
}
var g = class {
  #t;
  #e;
  #n = 0;
  constructor(t2, n = {}) {
    this.#t = t2, this.#e = n.nameServer ?? { ip: "127.0.0.1", port: 53 };
  }
  async #s(t2) {
    let n = { header: { id: this.#r(), isResponse: false, opcode: "QUERY", isAuthoritativeAnswer: false, isTruncated: false, isRecursionDesired: true, isRecursionAvailable: false, rcode: "NOERROR", questionCount: 0, answerCount: 0, authorityCount: 0, additionalCount: 0 }, questions: [{ name: t2.name, type: t2.type, class: "IN" }] }, s = await this.#t.open(), r2 = m2(n);
    await s.writable.getWriter().write({ host: this.#e.ip, port: this.#e.port, data: r2 });
    for await (let i of c2(s.readable)) {
      let p = D(i.data);
      if (p.header.id !== n.header.id) continue;
      if (p.header.rcode !== "NOERROR") throw new Error(`dns query failed with rcode: ${p.header.rcode}`);
      if (p.header.answerCount > 1) throw new Error("expected exactly one dns answer");
      let [c3] = p.answers ?? [];
      if (!c3) throw new Error("no dns answer found");
      return c3;
    }
    throw new Error("udp socket closed before receiving response");
  }
  async lookup(t2) {
    let n = await this.#s({ name: t2, type: "A" });
    if (!n || n.type !== "A") throw new Error(`no A record found for ${t2}`);
    return n.ip;
  }
  async reverse(t2) {
    let n = R(t2), s = await this.#s({ name: n, type: "PTR" });
    if (!s || s.type !== "PTR") throw new Error(`No PTR record found for ${t2}`);
    return s.ptr;
  }
  #r() {
    return this.#n = (this.#n + 1) % 65536, this.#n;
  }
};

// ../../../../../private/tmp/vendorbuild/node_modules/tcpip/dist/index.js
var l2 = class {
  #e = /* @__PURE__ */ new WeakMap();
  #t = /* @__PURE__ */ new WeakMap();
  setOuter(e, t2) {
    this.#e.set(e, t2);
  }
  setInner(e, t2) {
    this.#t.set(e, t2);
  }
  getOuter(e) {
    let t2 = this.#e.get(e);
    if (!t2) throw new Error(`outer hooks not set for ${e}`);
    return t2;
  }
  getInner(e) {
    let t2 = this.#t.get(e);
    if (!t2) throw new Error(`inner hooks not set for ${e}`);
    return t2;
  }
};
var O2 = class extends Number {
  free;
  constructor(e, t2) {
    super(e), this.free = t2;
  }
  [r]() {
    this.free(this.valueOf());
  }
};
var A2 = class extends Map {
  #e = /* @__PURE__ */ new Map();
  wait(e) {
    return new Promise((t2) => {
      let r2 = this.#e.get(e) ?? /* @__PURE__ */ new Set();
      r2.add(t2), this.#e.set(e, r2);
    });
  }
  set(e, t2) {
    super.set(e, t2);
    let r2 = this.#e.get(e);
    if (r2) for (let n of r2) n(t2), r2.delete(n);
    return this;
  }
};
var x2 = class extends ReadableStream {
  #e;
  constructor({ lock: e, ...t2 }, r2) {
    super(t2, r2), this.#e = e;
  }
  getReader() {
    let e = super.getReader();
    return this.locked && this.#e?.(), e;
  }
  pipeThrough(e, t2) {
    let r2 = super.pipeThrough(e, t2);
    return this.locked && this.#e?.(), r2;
  }
  pipeTo(e, t2) {
    let r2 = super.pipeTo(e, t2);
    return this.locked && this.#e?.(), r2;
  }
  tee() {
    let [e, t2] = super.tee();
    return this.locked && this.#e?.(), [e, t2];
  }
};
async function w3() {
  return await new Promise((i) => queueMicrotask(i));
}
var h2 = class {
  #e;
  get exports() {
    if (!this.#e) throw new Error("exports were not registered");
    return this.#e;
  }
  register(e) {
    this.#e = e;
  }
  smartMalloc(e) {
    return new O2(this.exports.malloc(e), this.exports.free);
  }
  copyToMemory(e) {
    let t2 = e.length, r2 = this.smartMalloc(t2);
    return new Uint8Array(this.exports.memory.buffer, r2.valueOf(), t2).set(e), r2;
  }
  copyFromMemory(e, t2) {
    let r2 = this.exports.memory.buffer.slice(Number(e), Number(e) + t2);
    return new Uint8Array(r2);
  }
  viewFromMemory(e, t2) {
    return new Uint8Array(this.exports.memory.buffer, Number(e), t2);
  }
};
var I = { ERR_OK: 0, ERR_MEM: -1, ERR_BUF: -2, ERR_TIMEOUT: -3, ERR_RTE: -4, ERR_INPROGRESS: -5, ERR_VAL: -6, ERR_WOULDBLOCK: -7, ERR_USE: -8, ERR_ALREADY: -9, ERR_ISCONN: -10, ERR_CONN: -11, ERR_IF: -12, ERR_ABRT: -13, ERR_RST: -14, ERR_CLSD: -15, ERR_ARG: -16 };
var _2 = new l2();
var M2 = class extends h2 {
  interfaces = /* @__PURE__ */ new Map();
  imports = { register_tap_interface: (e) => {
    let t2 = new z();
    _2.setOuter(t2, { handle: e, sendFrame: (r2) => {
      let n = this.copyToMemory(r2), s = this.exports.send_tap_interface(e, n, r2.length);
      if (s !== I.ERR_OK) throw new Error(`failed to send frame: ${s}`);
    }, getMacAddress: () => {
      let r2 = this.exports.get_interface_mac_address(e), n = this.viewFromMemory(r2, 6);
      return U(n);
    }, getIPv4Address: () => {
      let r2 = this.exports.get_interface_ip4_address(e);
      if (r2 === 0) return;
      let n = this.viewFromMemory(r2, 4);
      return P(n);
    }, getIPv4Netmask: () => {
      let r2 = this.exports.get_interface_ip4_netmask(e);
      if (r2 === 0) return;
      let n = this.viewFromMemory(r2, 4);
      return P(n);
    } }), this.interfaces.set(e, t2);
  }, receive_frame: async (e, t2, r2) => {
    let n = this.copyFromMemory(t2, r2);
    await w3();
    let s = this.interfaces.get(e);
    if (!s) {
      console.error("received frame on unknown tap interface");
      return;
    }
    _2.getInner(s).receiveFrame(new Uint8Array(n));
  } };
  async create(e) {
    var p = [];
    try {
      let t2 = e.mac ? v(e.mac) : ve();
      let { ipAddress: r2, netmask: n } = e.ip ? we(e.ip) : {};
      let s = a(p, this.copyToMemory(t2));
      let c3 = a(p, r2 ? this.copyToMemory(r2) : void 0);
      let o = a(p, n ? this.copyToMemory(n) : void 0);
      let a2 = this.exports.create_tap_interface(s, c3 ?? 0, o ?? 0);
      let m3 = this.interfaces.get(a2);
      if (!m3) throw new Error("tap interface failed to register");
      return m3;
    } catch (f) {
      var y = f, b2 = true;
    } finally {
      c(p, y, b2);
    }
  }
  async remove(e) {
    for (let [t2, r2] of this.interfaces.entries()) if (r2 === e) {
      this.exports.remove_tap_interface(t2), this.interfaces.delete(t2);
      return;
    }
  }
};
var z = class {
  #e;
  #t = false;
  type = "tap";
  get mac() {
    return _2.getOuter(this).getMacAddress();
  }
  get ip() {
    return _2.getOuter(this).getIPv4Address();
  }
  get netmask() {
    return _2.getOuter(this).getIPv4Netmask();
  }
  readable;
  writable;
  constructor() {
    _2.setInner(this, { receiveFrame: async (e) => {
      if (this.#t) {
        if (!this.#e) throw new Error("readable stream not initialized");
        this.#e.enqueue(e);
      }
    } }), this.readable = new x2({ start: (e) => {
      this.#e = e;
    }, lock: () => {
      this.#t = true;
    } }), this.writable = new WritableStream({ write: (e) => {
      try {
        _2.getOuter(this).sendFrame(e);
      } catch (t2) {
        console.error("tap interface send failed", t2);
      }
    } });
  }
  listen() {
    if (this.readable.locked) throw new Error("readable stream already locked");
    return c2(this.readable);
  }
  [Symbol.asyncIterator]() {
    return this.listen();
  }
};
var C2 = new l2();
var U2 = class extends h2 {
  interfaces = /* @__PURE__ */ new Map();
  imports = {};
  async create(e) {
    var y = [];
    try {
      let t2 = e.mac ? v(e.mac) : ve();
      let { ipAddress: r2, netmask: n } = e.ip ? we(e.ip) : {};
      let s = a(y, this.copyToMemory(t2));
      let c3 = a(y, r2 ? this.copyToMemory(r2) : void 0);
      let o = a(y, n ? this.copyToMemory(n) : void 0);
      let a2 = new Uint32Array(e.ports.map((k2) => Number(_2.getOuter(k2).handle)));
      let m3 = a(y, this.copyToMemory(new Uint8Array(a2.buffer)));
      let p = this.exports.create_bridge_interface(s, c3 ?? 0, o ?? 0, m3, e.ports.length);
      let f = new j();
      C2.setOuter(f, { handle: p, getMacAddress: () => {
        let k2 = this.exports.get_interface_mac_address(p), T2 = this.viewFromMemory(k2, 6);
        return U(T2);
      }, getIPv4Address: () => {
        let k2 = this.exports.get_interface_ip4_address(p);
        if (k2 === 0) return;
        let T2 = this.viewFromMemory(k2, 4);
        return P(T2);
      }, getIPv4Netmask: () => {
        let k2 = this.exports.get_interface_ip4_netmask(p);
        if (k2 === 0) return;
        let T2 = this.viewFromMemory(k2, 4);
        return P(T2);
      } });
      this.interfaces.set(p, f);
      return f;
    } catch (b2) {
      var v3 = b2, E2 = true;
    } finally {
      c(y, v3, E2);
    }
  }
  async remove(e) {
    for (let [t2, r2] of this.interfaces.entries()) if (r2 === e) {
      this.exports.remove_bridge_interface(t2), this.interfaces.delete(t2);
      return;
    }
  }
};
var j = class {
  type = "bridge";
  get mac() {
    return C2.getOuter(this).getMacAddress();
  }
  get ip() {
    return C2.getOuter(this).getIPv4Address();
  }
  get netmask() {
    return C2.getOuter(this).getIPv4Netmask();
  }
};
var L2 = new l2();
var Pe = 1e3;
var ve2 = Uint8Array.from({ length: 56 }, (i, e) => e);
var Te = 65535;
var Ae = Te - w - H;
var N = class extends h2 {
  #e;
  #t;
  #r = /* @__PURE__ */ new Map();
  constructor(e) {
    super(), this.#e = e;
  }
  imports = { receive_icmp_echo_reply: (e, t2, r2, n, s, c3) => {
    let o = P(this.copyFromMemory(t2, 4)), a2 = this.copyFromMemory(s, c3), m3 = this.#i(o, r2, n), p = this.#r.get(m3);
    if (!p || !this.#p(a2, p.payload)) return 0;
    this.#r.delete(m3), clearTimeout(p.timeoutId);
    let f = { host: o, identifier: r2, sequenceNumber: n, payload: a2, roundTripTime: Date.now() - p.startedAt };
    return w3().then(() => p.resolve(f)), 1;
  } };
  async createPingSession(e) {
    let t2 = await this.#s(e.host), r2 = this.#o(), n = e.timeout ?? Pe;
    this.#n();
    let s = new q2({ host: t2, identifier: r2, timeout: n });
    return L2.setOuter(s, { send: async (c3, o = {}) => {
      let a2 = o.payload ?? ve2, m3 = o.timeout ?? n;
      this.#c(a2);
      let p = this.#i(t2, r2, c3);
      if (this.#r.has(p)) throw new Error("icmp ping identifier and sequence number are in use");
      return await new Promise((f, y) => {
        let b2 = setTimeout(() => {
          this.#r.delete(p), y(new Error(`icmp ping timed out: ${t2}`));
        }, m3);
        this.#r.set(p, { host: t2, identifier: r2, sequenceNumber: c3, payload: a2, startedAt: Date.now(), timeoutId: b2, resolve: f, reject: y });
        try {
          var v3 = [];
          try {
            let H3 = a(v3, this.copyToMemory(u(t2)));
            let de = a(v3, this.copyToMemory(a2));
            let ee = this.exports.send_icmp_echo_request(this.#n(), H3, r2, c3, de, a2.length);
            if (ee !== I.ERR_OK) throw new Error(`failed to send icmp echo request: ${ee}`);
          } catch (E2) {
            var k2 = E2, T2 = true;
          } finally {
            c(v3, k2, T2);
          }
        } catch (H3) {
          clearTimeout(b2), this.#r.delete(p), y(H3 instanceof Error ? H3 : new Error(String(H3)));
        }
      });
    }, close: () => {
      for (let [c3, o] of this.#r) o.host === t2 && o.identifier === r2 && (clearTimeout(o.timeoutId), o.reject(new Error("icmp ping session closed")), this.#r.delete(c3));
    } }), L2.setInner(s, {}), s;
  }
  #n() {
    if (!this.#t) {
      let e = this.exports.open_icmp_socket();
      if (Number(e) === 0) throw new Error("failed to open icmp socket");
      this.#t = e;
    }
    return this.#t;
  }
  async #s(e) {
    try {
      return u(e), e;
    } catch {
      return await this.#e.lookup(e);
    }
  }
  #o() {
    let e = new Uint16Array(1);
    return crypto.getRandomValues(e), e[0];
  }
  #i(e, t2, r2) {
    return `${e}:${t2}:${r2}`;
  }
  #a(e, t2) {
    if (!Number.isInteger(e) || e < 0 || e > 65535) throw new Error(`${t2} must be an integer between 0 and 65535`);
  }
  #c(e) {
    if (e.length > Ae) throw new Error("icmp echo payload exceeds maximum IPv4 packet size");
  }
  #p(e, t2) {
    if (e.length !== t2.length) return false;
    for (let r2 = 0; r2 < e.length; r2++) if (e[r2] !== t2[r2]) return false;
    return true;
  }
};
var q2 = class {
  #e = false;
  #t = 0;
  host;
  identifier;
  timeout;
  constructor(e) {
    this.host = e.host, this.identifier = e.identifier, this.timeout = e.timeout;
  }
  async ping(e) {
    if (this.#e) throw new Error("icmp ping session closed");
    return await L2.getOuter(this).send(this.#r(), e);
  }
  async close() {
    this.#e || (this.#e = true, L2.getOuter(this).close());
  }
  #r() {
    let e = this.#t;
    return this.#t = this.#t + 1 & 65535, e;
  }
};
var $ = new l2();
var B2 = class extends h2 {
  interfaces = /* @__PURE__ */ new Map();
  imports = { register_loopback_interface: (e) => {
    let t2 = new G2();
    $.setOuter(t2, { handle: e, getIPv4Address: () => {
      let r2 = this.exports.get_interface_ip4_address(e);
      if (r2 === 0) return;
      let n = this.viewFromMemory(r2, 4);
      return P(n);
    }, getIPv4Netmask: () => {
      let r2 = this.exports.get_interface_ip4_netmask(e);
      if (r2 === 0) return;
      let n = this.viewFromMemory(r2, 4);
      return P(n);
    } }), this.interfaces.set(e, t2);
  } };
  async create(e) {
    var a2 = [];
    try {
      let { ipAddress: t2, netmask: r2 } = e.ip ? we(e.ip) : {};
      let n = a(a2, t2 ? this.copyToMemory(t2) : void 0);
      let s = a(a2, r2 ? this.copyToMemory(r2) : void 0);
      let c3 = this.exports.create_loopback_interface(n ?? 0, s ?? 0);
      let o = this.interfaces.get(c3);
      if (!o) throw new Error("loopback interface failed to register");
      return o;
    } catch (m3) {
      var p = m3, f = true;
    } finally {
      c(a2, p, f);
    }
  }
  async remove(e) {
    for (let [t2, r2] of this.interfaces.entries()) if (r2 === e) {
      this.exports.remove_loopback_interface(t2), this.interfaces.delete(t2);
      return;
    }
  }
};
var G2 = class {
  type = "loopback";
  get ip() {
    return $.getOuter(this).getIPv4Address();
  }
  get netmask() {
    return $.getOuter(this).getIPv4Netmask();
  }
};
var V2 = new l2();
var P2 = new l2();
var Q2 = 1448;
var xt = Q2 * 4;
var St = Q2 * 4;
var Ee = Q2;
var D2 = class extends h2 {
  #e = /* @__PURE__ */ new Map();
  #t = /* @__PURE__ */ new Map();
  #r = new A2();
  #n = /* @__PURE__ */ new Map();
  #s = /* @__PURE__ */ new Map();
  #o;
  async #i(e) {
    try {
      return u(e);
    } catch {
      let r2 = await this.#o.lookup(e);
      return u(r2);
    }
  }
  constructor(e) {
    super(), this.#o = e;
  }
  async #a(e) {
    for (; ; ) {
      let t2 = this.exports.close_tcp_connection(e);
      if (t2 === I.ERR_OK) return;
      if (t2 !== I.ERR_MEM) throw new Error(`failed to close tcp connection: ${t2}`);
      await new Promise((r2) => {
        this.#s.set(e, r2);
      });
    }
  }
  async #c(e) {
    for (; ; ) {
      let t2 = this.exports.shutdown_tcp_connection_write(e);
      if (t2 === I.ERR_OK) return;
      if (t2 !== I.ERR_MEM) throw new Error(`failed to shutdown tcp write side: ${t2}`);
      await new Promise((r2) => {
        this.#s.set(e, r2);
      });
    }
  }
  imports = { accept_tcp_connection: async (e, t2) => {
    let r2 = this.#e.get(e);
    if (!r2) {
      console.error("new tcp connection to unknown listener");
      return;
    }
    let n = new W2();
    P2.setOuter(n, { send: async (s) => {
      let c3 = Number(this.copyToMemory(s)), o = this.exports.send_tcp_chunk(t2, c3, s.length);
      for (; o < s.length; ) {
        await new Promise((m3) => {
          this.#n.set(t2, m3);
        });
        let a2 = s.length - o;
        o += this.exports.send_tcp_chunk(t2, c3 + o, a2);
      }
    }, updateReceiveBuffer: (s) => {
      this.exports.update_tcp_receive_buffer(t2, s);
    }, close: async () => {
      await this.#a(t2);
    }, closeWrite: async () => {
      await this.#c(t2);
    } }), this.#t.set(t2, n), await w3(), V2.getInner(r2).accept(n);
  }, connected_tcp_connection: async (e) => {
    let t2 = new W2();
    P2.setOuter(t2, { send: async (r2) => {
      let n = Number(this.copyToMemory(r2)), s = this.exports.send_tcp_chunk(e, n, r2.length);
      for (; s < r2.length; ) {
        await new Promise((o) => {
          this.#n.set(e, o);
        });
        let c3 = r2.length - s;
        s += this.exports.send_tcp_chunk(e, n + s, c3);
      }
    }, updateReceiveBuffer: (r2) => {
      this.exports.update_tcp_receive_buffer(e, r2);
    }, close: async () => {
      await this.#a(e);
    }, closeWrite: async () => {
      await this.#c(e);
    } }), this.#t.set(e, t2), await w3(), this.#r.set(e, t2);
  }, closed_tcp_connection: async (e) => {
    let t2 = this.#t.get(e);
    if (!t2) {
      console.error("received close on unknown tcp connection");
      return;
    }
    await P2.getInner(t2).close();
  }, receive_tcp_chunk: async (e, t2, r2) => {
    let n = this.copyFromMemory(t2, r2), s = this.#t.get(e);
    if (!s) {
      console.error("received chunk on unknown tcp connection");
      return;
    }
    await w3(), P2.getInner(s).receive(new Uint8Array(n));
  }, sent_tcp_chunk: (e, t2) => {
    let r2 = this.#n.get(e);
    this.#n.delete(e), r2?.(t2);
    let n = this.#s.get(e);
    this.#s.delete(e), n?.();
  } };
  async listen(e) {
    var s = [];
    try {
      let t2 = a(s, e.host ? this.copyToMemory(await this.#i(e.host)) : null);
      let r2 = this.exports.create_tcp_listener(t2, e.port);
      let n = new X2();
      V2.setOuter(n, {});
      this.#e.set(r2, n);
      return n;
    } catch (c3) {
      var o = c3, a2 = true;
    } finally {
      c(s, o, a2);
    }
  }
  async connect(e) {
    var s = [];
    try {
      let t2 = a(s, this.copyToMemory(await this.#i(e.host)));
      let r2 = this.exports.create_tcp_connection(t2, e.port);
      let n = await this.#r.wait(r2);
      if (!n) throw new Error("tcp failed to connect");
      return n;
    } catch (c3) {
      var o = c3, a2 = true;
    } finally {
      c(s, o, a2);
    }
  }
};
var X2 = class {
  #e = [];
  #t;
  constructor() {
    V2.setInner(this, { accept: async (e) => {
      this.#e.push(e), this.#t?.();
    } });
  }
  async *[Symbol.asyncIterator]() {
    for (; ; ) await new Promise((e) => {
      this.#t = e;
    }), yield* this.#e, this.#e = [];
  }
};
var W2 = class {
  #e = [];
  #t;
  #r;
  #n = false;
  #s = false;
  readable;
  writable;
  constructor() {
    P2.setInner(this, { receive: async (e) => {
      this.#e.push(e), this.#a();
    }, close: async () => {
      await w3(), this.#n = true, this.#a();
    } }), this.readable = new ReadableStream({ start: (e) => {
      this.#t = e;
    }, pull: () => {
      this.#a();
    } }, { highWaterMark: Ee, size: (e) => e.byteLength }), this.writable = new WritableStream({ start: (e) => {
      this.#r = e;
    }, write: async (e) => {
      await P2.getOuter(this).send(e);
    }, close: async () => {
      await P2.getOuter(this).closeWrite();
    } }, { highWaterMark: 1 });
  }
  #o() {
    if (!this.#s) {
      this.#s = true;
      try {
        this.#t?.close();
      } catch {
      }
    }
  }
  #i(e) {
    if (!this.#s) {
      this.#s = true;
      try {
        this.#t?.error(e);
      } catch {
      }
    }
  }
  #a() {
    if (this.#n && this.#e.length === 0) {
      this.#o(), (()=>{try{this.#r?.error(new Error("tcp connection closed"))}catch{}})();
      return;
    }
    if (!(this.#t?.desiredSize > 0)) return;
    let e = 0;
    for (; this.#e.length > 0; ) {
      let t2 = this.#e[0].length;
      if (e > 0 && e + t2 > this.#t.desiredSize) break;
      let r2 = this.#e.shift();
      this.#t.enqueue(r2), e += r2.length;
    }
    e > 0 && P2.getOuter(this).updateReceiveBuffer(e), this.#n && this.#e.length === 0 && (this.#o(), (()=>{try{this.#r?.error(new Error("tcp connection closed"))}catch{}})());
  }
  async close() {
    await P2.getOuter(this).close(), this.#i(new Error("tcp connection closed")), (()=>{try{this.#r?.error(new Error("tcp connection closed"))}catch{}})();
  }
  [Symbol.asyncIterator]() {
    if (this.readable.locked) throw new Error("readable stream already locked");
    return c2(this.readable);
  }
};
var S = new l2();
var F2 = class extends h2 {
  interfaces = /* @__PURE__ */ new Map();
  imports = { register_tun_interface: (e) => {
    let t2 = new Y2();
    S.setOuter(t2, { handle: e, sendPacket: (r2) => {
      let n = this.copyToMemory(r2);
      this.exports.send_tun_interface(e, n, r2.length);
    }, getIPv4Address: () => {
      let r2 = this.exports.get_interface_ip4_address(e);
      if (r2 === 0) return;
      let n = this.viewFromMemory(r2, 4);
      return P(n);
    }, getIPv4Netmask: () => {
      let r2 = this.exports.get_interface_ip4_netmask(e);
      if (r2 === 0) return;
      let n = this.viewFromMemory(r2, 4);
      return P(n);
    } }), this.interfaces.set(e, t2);
  }, receive_packet: async (e, t2, r2) => {
    let n = this.copyFromMemory(t2, r2);
    await w3();
    let s = this.interfaces.get(e);
    if (!s) {
      console.error("received packet on unknown tun interface");
      return;
    }
    S.getInner(s).receivePacket(new Uint8Array(n));
  } };
  async create(e) {
    var a2 = [];
    try {
      let { ipAddress: t2, netmask: r2 } = e.ip ? we(e.ip) : {};
      let n = a(a2, t2 ? this.copyToMemory(t2) : void 0);
      let s = a(a2, r2 ? this.copyToMemory(r2) : void 0);
      let c3 = this.exports.create_tun_interface(n ?? 0, s ?? 0);
      let o = this.interfaces.get(c3);
      if (!o) throw new Error("tun interface failed to register");
      return o;
    } catch (m3) {
      var p = m3, f = true;
    } finally {
      c(a2, p, f);
    }
  }
  async remove(e) {
    for (let [t2, r2] of this.interfaces.entries()) if (r2 === e) {
      this.exports.remove_tun_interface(t2), this.interfaces.delete(t2);
      return;
    }
  }
};
var Y2 = class {
  #e;
  #t = false;
  type = "tun";
  get ip() {
    return S.getOuter(this).getIPv4Address();
  }
  get netmask() {
    return S.getOuter(this).getIPv4Netmask();
  }
  readable;
  writable;
  constructor() {
    S.setInner(this, { receivePacket: async (e) => {
      if (this.#t) {
        if (!this.#e) throw new Error("readable stream not initialized");
        this.#e?.enqueue(e);
      }
    } }), this.readable = new x2({ start: (e) => {
      this.#e = e;
    }, lock: () => {
      this.#t = true;
    } }), this.writable = new WritableStream({ write: (e) => {
      S.getOuter(this).sendPacket(e);
    } });
  }
  listen() {
    if (this.readable.locked) throw new Error("readable stream already locked");
    return c2(this.readable);
  }
  [Symbol.asyncIterator]() {
    return this.listen();
  }
};
var R2 = new l2();
var K = class extends h2 {
  #e = new A2();
  #t;
  async #r(e) {
    try {
      return u(e);
    } catch {
      let r2 = await this.#t.lookup(e);
      return u(r2);
    }
  }
  constructor(e) {
    super(), this.#t = e;
  }
  imports = { receive_udp_datagram: async (e, t2, r2, n, s) => {
    let c3 = this.copyFromMemory(t2, 4), o = this.copyFromMemory(n, s), a2 = this.#e.get(e);
    if (!a2) {
      console.error("received datagram on unknown udp socket");
      return;
    }
    await w3(), R2.getInner(a2).receive({ host: P(c3), port: r2, data: o });
  } };
  async open(e) {
    var s = [];
    try {
      let t2 = a(s, e.host ? this.copyToMemory(await this.#r(e.host)) : null);
      let r2 = this.exports.open_udp_socket(t2, e.port ?? 0);
      if (Number(r2) === 0) throw new Error("failed to open udp socket");
      let n = new Z();
      R2.setOuter(n, { send: async (m3) => {
        var b2 = [];
        try {
          let p = a(b2, this.copyToMemory(await this.#r(m3.host)));
          let f = a(b2, this.copyToMemory(m3.data));
          let y = this.exports.send_udp_datagram(r2, p, m3.port, f, m3.data.length);
          if (y !== I.ERR_OK) throw new Error(`failed to send udp datagram: ${y}`);
        } catch (v3) {
          var E2 = v3, k2 = true;
        } finally {
          c(b2, E2, k2);
        }
      }, close: async () => {
        this.exports.close_udp_socket(r2), this.#e.delete(r2);
      } });
      this.#e.set(r2, n);
      return n;
    } catch (c3) {
      var o = c3, a2 = true;
    } finally {
      c(s, o, a2);
    }
  }
};
var Z = class {
  #e;
  #t;
  readable;
  writable;
  constructor() {
    R2.setInner(this, { receive: async (e) => {
      if (!this.#e) throw new Error("readable controller not initialized");
      this.#e.enqueue(e);
    } }), this.readable = new ReadableStream({ start: (e) => {
      this.#e = e;
    } }), this.writable = new WritableStream({ start: (e) => {
      this.#t = e;
    }, write: async (e) => {
      await R2.getOuter(this).send(e);
    } });
  }
  async close() {
    await R2.getOuter(this).close(), this.#e?.error(new Error("udp socket closed")), this.#t?.error(new Error("udp socket closed"));
  }
  [Symbol.asyncIterator]() {
    if (this.readable.locked) throw new Error("readable stream already locked");
    return c2(this.readable);
  }
};
var Ce = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string";
async function ce(i, e) {
  return Ce ? Ue(i, e) : fetch(i);
}
async function Ue(i, e) {
  let t2 = await import("fs"), { Readable: r2 } = await import("stream"), n = t2.createReadStream(i), s = r2.toWeb(n);
  return new Response(s, { headers: { "Content-Type": e } });
}
async function We(i) {
  let e = new J(i);
  return await e.ready, e;
}
var J = class {
  #e;
  #t;
  #r;
  #n;
  #s;
  #o;
  #i;
  #a;
  #c;
  #p;
  ready;
  tcp;
  udp;
  ping;
  interfaces;
  constructor(e = {}) {
    this.#e = { ...e, initializeLoopback: e.initializeLoopback ?? true }, this.#n = new B2(), this.#s = new F2(), this.#o = new M2(), this.#i = new U2(), this.tcp = { connect: async (t2) => (await this.ready, this.#a.connect(t2)), listen: async (t2) => (await this.ready, this.#a.listen(t2)) }, this.udp = { open: async (t2 = {}) => (await this.ready, this.#c.open(t2)) }, this.ping = { createSession: async (t2) => (await this.ready, this.#p.createPingSession(t2)) }, this.interfaces = { createLoopback: async (t2) => (await this.ready, this.#n.create(t2)), createTun: async (t2) => (await this.ready, this.#s.create(t2)), createTap: async (t2 = {}) => (await this.ready, this.#o.create(t2)), createBridge: async (t2) => (await this.ready, this.#i.create(t2)), remove: async (t2) => {
      switch (await this.ready, t2.type) {
        case "loopback":
          return this.#n.remove(t2);
        case "tun":
          return this.#s.remove(t2);
        case "tap":
          return this.#o.remove(t2);
        case "bridge":
          return this.#i.remove(t2);
        default:
          throw new Error("unknown interface type");
      }
    }, [Symbol.iterator]: () => this.#m() }, this.#r = new g(this.udp, { nameServer: e.nameServer ?? { ip: "127.0.0.1", port: 53 } }), this.#a = new D2(this.#r), this.#c = new K(this.#r), this.#p = new N(this.#r), this.ready = this.#d(), this.ready.then(async () => {
      this.#e.initializeLoopback && await this.interfaces.createLoopback({ ip: "127.0.0.1/8" });
    });
  }
  async #d() {
    let e = new WASI([], [], [new OpenFile(new File([])), ConsoleStdout.lineBuffered((s) => console.log(`[WASI stdout] ${s}`)), ConsoleStdout.lineBuffered((s) => console.warn(`[WASI stderr] ${s}`))]), t2 = ce(new URL("../tcpip.wasm", import.meta.url), "application/wasm"), { instance: r2 } = await WebAssembly.instantiateStreaming(t2, { wasi_snapshot_preview1: e.wasiImport, env: { ...this.#n.imports, ...this.#s.imports, ...this.#o.imports, ...this.#i.imports, ...this.#a.imports, ...this.#c.imports, ...this.#p.imports } }), n = r2;
    this.#n.register(n.exports), this.#s.register(n.exports), this.#o.register(n.exports), this.#i.register(n.exports), this.#a.register(n.exports), this.#c.register(n.exports), this.#p.register(n.exports), e.initialize(n), this.#t = Number(setInterval(() => {
      n.exports.process_queued_packets(), n.exports.process_timeouts();
    }, 100));
  }
  *#m() {
    yield* this.#n.interfaces.values(), yield* this.#s.interfaces.values(), yield* this.#o.interfaces.values(), yield* this.#i.interfaces.values();
  }
  createLoopbackInterface(...e) {
    return this.interfaces.createLoopback(...e);
  }
  createTunInterface(...e) {
    return this.interfaces.createTun(...e);
  }
  createTapInterface(...e) {
    return this.interfaces.createTap(...e);
  }
  createBridgeInterface(...e) {
    return this.interfaces.createBridge(...e);
  }
  removeInterface(...e) {
    return this.interfaces.remove(...e);
  }
  listenTcp(...e) {
    return this.tcp.listen(...e);
  }
  connectTcp(...e) {
    return this.tcp.connect(...e);
  }
  openUdp(...e) {
    return this.udp.open(...e);
  }
  createPingSession(...e) {
    return this.ping.createSession(...e);
  }
};
export {
  We as createStack
};
