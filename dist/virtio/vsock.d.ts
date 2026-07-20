import { type VirtioDevice } from "./core.ts";
/** A stream connection between this process and a guest, over vsock. */
export interface VsockConnection {
    /** Reads the next chunk; an empty chunk means the peer closed. */
    read(): Promise<Uint8Array>;
    /** Reads `length` bytes, or fewer if the peer closes first. */
    readExactly(length: number): Promise<Uint8Array>;
    /** Writes data, waiting for credit when the peer's buffer is full. */
    write(data: Uint8Array): Promise<void>;
    /** Closes the connection. */
    close(): void;
}
/**
 * A virtio-vsock device: stream sockets between the guest and this process,
 * addressed by port.
 */
export interface VsockDevice extends VirtioDevice {
    /** Connects to a vsock listener on `port` in the guest. */
    connect(port: number, options?: {
        /** Connection timeout in milliseconds. Defaults to 5000. */
        timeoutMs?: number;
    }): Promise<VsockConnection>;
    /** Closes the device and every connection on it. */
    close(): void;
}
/**
 * A virtio-vsock device. `guestCid` is the context ID assigned to the
 * guest, defaulting to 3.
 */
export declare function vsockDevice({ guestCid }?: {
    guestCid?: bigint;
}): VsockDevice;
