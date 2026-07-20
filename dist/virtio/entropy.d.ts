import { type VirtioDevice } from "./core.ts";
/** A virtio entropy source, feeding the guest's randomness pool from `crypto.getRandomValues`. */
export declare function entropyDevice(): VirtioDevice;
