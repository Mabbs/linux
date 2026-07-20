import { type VirtioDevice } from "./core.ts";
type MaybePromise<T> = T | Promise<T>;
/** The storage behind a block device. */
export interface BlockDeviceStorage {
    /** Returns `length` bytes at `offset`. */
    read(offset: number, length: number): MaybePromise<Uint8Array>;
    /** Writes `data` at `offset`, returning the bytes written. Without it the device is read-only. */
    write?(offset: number, data: Uint8Array): MaybePromise<number>;
    /** Flushes completed writes. Its presence advertises the flush feature. */
    flush?(): MaybePromise<void>;
    /** Total size in bytes. */
    capacity: number;
}
/**
 * A virtio block device backed by a storage object.
 *
 * @example Serve a read-only root filesystem image
 * ```ts
 * blockDevice({
 *   capacity: rootfs.byteLength,
 *   read: (offset, length) => rootfs.subarray(offset, offset + length),
 * })
 * ```
 */
export declare function blockDevice(storage: BlockDeviceStorage): VirtioDevice;
export {};
