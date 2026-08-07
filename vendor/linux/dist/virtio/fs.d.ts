import { type VirtioDevice } from "./core.ts";
type MaybePromise<T> = T | PromiseLike<T>;
declare const Errno: {
    readonly EPERM: 1;
    readonly ENOENT: 2;
    readonly EIO: 5;
    readonly EBADF: 9;
    readonly EACCES: 13;
    readonly EEXIST: 17;
    readonly ENOTDIR: 20;
    readonly EISDIR: 21;
    readonly EINVAL: 22;
    readonly ENOSPC: 28;
    readonly EROFS: 30;
    readonly EPROTO: 71;
    readonly ENAMETOOLONG: 36;
    readonly ENOSYS: 38;
    readonly ENOTEMPTY: 39;
    readonly ELOOP: 40;
    readonly EOPNOTSUPP: 95;
};
export type FSErrorCode = keyof typeof Errno;
/** An expected filesystem failure which should be returned to the guest. */
export declare class FSError extends Error {
    readonly errno: number;
    constructor(code: FSErrorCode, message?: string);
}
export interface FSTimestamp {
    seconds: bigint;
    nanoseconds?: number;
}
/**
 * Unix metadata presented to the guest. `mode` includes both the file type
 * bits and permissions (for example `0o100644` for a regular file).
 */
export interface FSAttributes {
    mode: number;
    size: bigint;
    atime?: FSTimestamp;
    mtime?: FSTimestamp;
    ctime?: FSTimestamp;
    blocks?: bigint;
    nlink?: number;
    uid?: number;
    gid?: number;
    rdev?: number;
    blockSize?: number;
}
export interface FSSetAttributes {
    mode?: number;
    size?: bigint;
    uid?: number;
    gid?: number;
    atime?: FSTimestamp | "now";
    mtime?: FSTimestamp | "now";
    ctime?: FSTimestamp;
}
export interface FSDirectoryEntry<TNode> {
    name: string;
    node: TNode;
}
export interface FSStat {
    blocks?: bigint;
    blocksFree?: bigint;
    blocksAvailable?: bigint;
    files?: bigint;
    filesFree?: bigint;
    blockSize?: number;
    fragmentSize?: number;
    nameLength?: number;
}
export interface FSCreateContext {
    mode: number;
    uid: number;
    gid: number;
}
/**
 * The host-side filesystem contract used by virtio-fs.
 *
 * Names are single, valid UTF-8 path components. Methods which are absent are
 * reported to the guest as unsupported; sync methods may return promises.
 *
 * `TNode` and `THandle` are the backend's node and open-file types; the device
 * never inspects them. A writable backend (one providing `write` or `create`)
 * must also provide `flush` and `fsync` — no-ops are the explicit way to
 * declare an already-durable or ephemeral store.
 */
export interface FS<TNode, THandle> {
    readonly root: TNode;
    lookup(parent: TNode, name: string): MaybePromise<TNode | undefined>;
    getattr(node: TNode, handle?: THandle): MaybePromise<FSAttributes>;
    setattr?(node: TNode, attributes: FSSetAttributes, handle?: THandle): MaybePromise<FSAttributes>;
    readlink?(node: TNode): MaybePromise<string>;
    symlink?(parent: TNode, name: string, target: string, context: FSCreateContext): MaybePromise<TNode>;
    mkdir?(parent: TNode, name: string, context: FSCreateContext): MaybePromise<TNode>;
    unlink?(parent: TNode, name: string): MaybePromise<void>;
    rmdir?(parent: TNode, name: string): MaybePromise<void>;
    rename?(oldParent: TNode, oldName: string, newParent: TNode, newName: string): MaybePromise<void>;
    open?(node: TNode, flags: number): MaybePromise<THandle>;
    create?(parent: TNode, name: string, flags: number, context: FSCreateContext): MaybePromise<{
        node: TNode;
        handle: THandle;
    }>;
    read?(node: TNode, handle: THandle, offset: bigint, length: number): MaybePromise<Uint8Array>;
    write?(node: TNode, handle: THandle, offset: bigint, data: Uint8Array): MaybePromise<number>;
    flush?(node: TNode, handle: THandle): MaybePromise<void>;
    fsync?(node: TNode, handle: THandle, dataOnly: boolean): MaybePromise<void>;
    release?(node: TNode, handle: THandle): MaybePromise<void>;
    opendir?(node: TNode, flags: number): MaybePromise<THandle>;
    readdir?(node: TNode, handle: THandle): MaybePromise<Iterable<FSDirectoryEntry<TNode>> | AsyncIterable<FSDirectoryEntry<TNode>>>;
    releasedir?(node: TNode, handle: THandle): MaybePromise<void>;
    access?(node: TNode, mask: number): MaybePromise<void>;
    statfs?(node: TNode): MaybePromise<FSStat>;
    destroy?(): MaybePromise<void>;
}
export interface FSDeviceOptions {
    /** Mount tag advertised to the guest. */
    tag: string;
    /**
     * Cache metadata and names in the guest for one second. Defaults to true.
     *
     * When false, FUSE entry and attribute validity are zero. This does not
     * disable the guest data page cache and does not provide direct I/O.
     */
    cache?: boolean;
}
type AnyFn = (...args: never[]) => unknown;
/**
 * Writable filesystems must declare how they persist writes: a backend
 * providing `write` or `create` also has to implement `flush` and `fsync`,
 * even as no-ops. Omission is a compile error here and a construction error
 * at runtime.
 */
type RequiresDurability<T> = T extends {
    write: AnyFn;
} | {
    create: AnyFn;
} ? {
    flush: AnyFn;
    fsync: AnyFn;
} : unknown;
/**
 * Creates a virtio-fs device backed by a JavaScript filesystem object.
 *
 * Cached devices use one-second metadata/name validity; `cache: false` uses
 * zero validity. Both retain the guest data page cache. This transport does not
 * advertise direct I/O: upstream virtio-fs extracts the caller's user pages,
 * while wasm process memory is private to its owner worker and cannot be placed
 * directly on the shared virtqueue. Supporting it would require a separate
 * kernel bounce-buffer implementation.
 *
 * Neither policy enables DAX or a writeback cache.
 */
export declare function fileSystemDevice<TNode extends object, THandle, T extends FS<TNode, THandle>>(filesystem: T & RequiresDurability<T>, options: FSDeviceOptions): VirtioDevice;
export {};
