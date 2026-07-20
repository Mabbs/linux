// SPDX-License-Identifier: MIT
import { Struct, U16LE } from "../bytes.js";
import { assert } from "../util.js";
import { VirtioController, } from "./core.js";
const Features = {
    SIZE: 1n << 0n,
};
class ConsoleConfig extends Struct({
    columns: U16LE,
    rows: U16LE,
}) {
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
export function consoleDevice(input, output) {
    const reader = input?.getReader();
    const writer = output?.getWriter();
    const config_bytes = new Uint8Array(ConsoleConfig.size);
    const config = new ConsoleConfig(config_bytes);
    config.columns = 80;
    config.rows = 24;
    let writing;
    async function write_input(queue) {
        assert(reader);
        const queue_iter = queue[Symbol.iterator]();
        for (;;) {
            const { value, done } = await reader.read();
            if (done)
                break;
            let chunk = value;
            while (chunk.length > 0) {
                const chain = queue_iter.next().value;
                if (!chain) {
                    console.warn("no more descriptors, dropping console input");
                    break;
                }
                const [desc, trailing] = chain;
                assert(desc && desc.writable, "receiver must be writable");
                assert(!trailing, "too many descriptors");
                const n = Math.min(chunk.length, desc.array.byteLength);
                desc.array.set(chunk.subarray(0, n));
                chunk = chunk.subarray(n);
                chain.release(n);
            }
        }
    }
    function notify_input(queue) {
        return (writing ??= write_input(queue));
    }
    async function notify_output(queue) {
        for (const chain of queue) {
            let n = 0;
            for (const { array, writable } of chain) {
                assert(!writable, "transmitter must be readable");
                await writer?.write(array);
                n += array.byteLength;
            }
            chain.release(n);
        }
    }
    const controller = new VirtioController({ deviceId: 3, features: Features.SIZE, config: config_bytes }, {
        queues: [reader ? notify_input : () => { }, notify_output],
        close() {
            void reader?.cancel().catch(() => { });
            void writer?.close().catch(() => { });
        },
    });
    function resize(columns, rows) {
        assert(Number.isInteger(columns) && columns > 0 && columns <= 0xffff, "console columns must be a positive 16-bit integer");
        assert(Number.isInteger(rows) && rows > 0 && rows <= 0xffff, "console rows must be a positive 16-bit integer");
        if (config.columns === columns && config.rows === rows)
            return;
        config.columns = columns;
        config.rows = rows;
        controller.updateConfig(config_bytes);
    }
    return controller.expose({ resize });
}
