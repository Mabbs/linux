import { type VirtioDevice } from "./core.ts";
/**
 * The console device: a `VirtioDevice` whose dimensions can be changed
 * after boot.
 */
export interface ConsoleDevice extends VirtioDevice {
    /**
     * Changes the console's dimensions; the console boots at 80×24. The guest
     * sees the new size and delivers `SIGWINCH` to the foreground process.
     */
    resize(columns: number, rows: number): void;
}
/**
 * A virtio console: a byte pipe to a tty, visible in the guest as
 * `/dev/hvc0`.
 *
 * `input` is a `ReadableStream` of bytes to the tty — what a keyboard would
 * send. `output` is a `WritableStream` of bytes from the tty — what a
 * terminal would render. Either may be `null`: `consoleDevice(null, output)`
 * is a read-only console, such as a boot log.
 */
export declare function consoleDevice(input: ReadableStream<Uint8Array> | null, output: WritableStream<Uint8Array> | null): ConsoleDevice;
