import type { Imports } from "../wasm.ts";
/** One descriptor's view into the machine's memory. */
export interface VirtqueueBuffer {
    readonly array: Uint8Array;
    /** Whether the guest driver allows the device to write to this buffer. */
    readonly writable: boolean;
}
/** A chain of descriptors making up one request. */
export interface VirtqueueChain extends Iterable<VirtqueueBuffer> {
    /** Completes the chain, reporting how many bytes the device wrote. */
    release(written: number): void;
}
/** A virtqueue: iterate it to take the pending chains. */
export interface Virtqueue extends Iterable<VirtqueueChain> {
}
type RaiseConfigInterrupt = () => void;
/** The identity, features, and configuration space of a virtio device. */
export interface VirtioDeviceOptions {
    /** The virtio device ID: 1 is net, 3 is console, 4 is entropy. */
    deviceId: number;
    /** Device-specific feature bits; transport features are added automatically. */
    features?: bigint;
    /** The device's configuration space, read by the guest driver. */
    config?: Uint8Array;
}
/** Called when the guest driver notifies a virtqueue. */
export type VirtqueueHandler = (queue: Virtqueue, controller: VirtioController) => void | PromiseLike<void>;
/** The behavior of a device behind a `VirtioController`. */
export interface VirtioDriver {
    /** One handler per virtqueue. */
    readonly queues: readonly VirtqueueHandler[];
    /** Called when the device is closed. */
    close?(controller: VirtioController): void;
}
interface TransportDevice {
    readonly device_id: number;
    readonly features: bigint;
    readonly config: Uint8Array;
    attach(get_config: () => Uint8Array, raise_config: RaiseConfigInterrupt): void;
    notify(vq: number, queue: Virtqueue): void | PromiseLike<void>;
    close(): void;
}
declare const transport_device: unique symbol;
/** A virtio device that can be attached to a machine. */
export interface VirtioDevice {
    readonly [transport_device]: TransportDevice;
}
/**
 * The device side of a virtio device: feature negotiation, virtqueues,
 * configuration space, and interrupts. A custom device constructs one with
 * a device ID and queue handlers, and attaches the resulting `device` to
 * the machine.
 */
export declare class VirtioController {
    /** The attachable device. */
    readonly device: VirtioDevice;
    /** Pushes a new configuration to the guest and raises a config-change interrupt. */
    readonly updateConfig: (config: Uint8Array) => void;
    /** Closes the device. */
    readonly close: () => void;
    /** Merges extra methods into the public device object; callable once. */
    readonly expose: <API extends object>(api: API) => VirtioDevice & API;
    /** Creates a virtio device backed by `driver`. */
    constructor(options: VirtioDeviceOptions, driver: VirtioDriver);
}
export declare function virtio_device_description(device: VirtioDevice): {
    device_id: number;
    features: bigint;
    config: Uint8Array<ArrayBufferLike>;
};
export declare function close_virtio_device(device: VirtioDevice): void;
export declare function virtio_imports({ memory, devices, trigger_irq, on_error, }: {
    memory: WebAssembly.Memory;
    devices: readonly VirtioDevice[];
    trigger_irq: (irq: number) => void;
    on_error: (error: unknown) => void;
}): Imports["virtio"];
export {};
