// SPDX-License-Identifier: MIT
import { assert } from "../util.js";
import { VirtioController, } from "./core.js";
/** A virtio entropy source, feeding the guest's randomness pool from `crypto.getRandomValues`. */
export function entropyDevice() {
    function notify(queue) {
        for (const chain of queue) {
            let n = 0;
            for (const { array, writable } of chain) {
                assert(writable);
                // can't use crypto.getRandomValues on a SharedArrayBuffer
                const arr = new Uint8Array(array.length);
                crypto.getRandomValues(arr);
                array.set(arr);
                n += array.byteLength;
            }
            chain.release(n);
        }
    }
    return new VirtioController({ deviceId: 4 }, { queues: [notify] }).device;
}
