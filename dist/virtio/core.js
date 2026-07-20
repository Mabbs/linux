// SPDX-License-Identifier: MIT
import { Struct, U16LE, U32LE, U64LE } from "../bytes.js";
import { assert } from "../util.js";
const TransportFeatures = {
    VERSION_1: 1n << 32n,
    RING_PACKED: 1n << 34n,
    INDIRECT_DESC: 1n << 28n,
};
const DescriptorFlags = {
    NEXT: 1 << 0,
    WRITE: 1 << 1,
    INDIRECT: 1 << 2,
    AVAIL: 1 << 7,
    USED: 1 << 15,
};
class VirtqDescriptor extends Struct({
    addr: U64LE,
    len: U32LE,
    id: U16LE,
    flags: U16LE,
}) {
}
class Chain {
    #memory;
    #desc;
    #release;
    constructor(memory, desc, release) {
        this.#memory = memory;
        this.#desc = desc;
        this.#release = release;
    }
    release(written) {
        this.#release(written);
    }
    *[Symbol.iterator]() {
        for (const desc of this.#desc) {
            yield {
                array: new Uint8Array(this.#memory.buffer, Number(desc.addr), desc.len),
                writable: (desc.flags & DescriptorFlags.WRITE) !== 0,
            };
        }
    }
}
class PackedVirtqueue {
    #memory;
    #size;
    #desc_addr;
    #on_release;
    #avail_wrap = true;
    #used_wrap = true;
    #used_idx = 0;
    #avail_idx = 0;
    constructor(memory, size, desc_addr, on_release) {
        assert(size !== 0);
        this.#memory = memory;
        this.#size = size;
        this.#desc_addr = desc_addr;
        this.#on_release = on_release;
    }
    #descriptor(index) {
        const desc = VirtqDescriptor.get(new DataView(this.#memory.buffer), this.#desc_addr + VirtqDescriptor.size * index);
        return {
            addr: desc.addr,
            len: desc.len,
            id: desc.id,
            flags: desc.flags,
        };
    }
    #indirect_descriptors(address, count) {
        const descriptors = [];
        for (let i = 0; i < count; i++) {
            const desc = VirtqDescriptor.get(new DataView(this.#memory.buffer), address + VirtqDescriptor.size * i);
            descriptors.push({
                addr: desc.addr,
                len: desc.len,
                id: desc.id,
                flags: desc.flags,
            });
        }
        return descriptors;
    }
    #pop() {
        let i = this.#advance();
        if (i === null)
            return null;
        let desc = this.#descriptor(i);
        const id = desc.id;
        let skip = 1;
        let chain_desc = [desc];
        if (desc.flags & DescriptorFlags.NEXT) {
            do {
                i = this.#advance();
                if (i === null)
                    throw new Error("no next descriptor is available");
                desc = this.#descriptor(i);
                chain_desc.push(desc);
                skip += 1;
            } while (desc.flags & DescriptorFlags.NEXT);
        }
        else if (desc.flags & DescriptorFlags.INDIRECT) {
            if (desc.len % VirtqDescriptor.size !== 0) {
                throw new Error("malformed indirect buffer");
            }
            chain_desc = this.#indirect_descriptors(Number(desc.addr), desc.len / VirtqDescriptor.size);
        }
        return new Chain(this.#memory, chain_desc, (written) => this.#release(id, skip, written));
    }
    *[Symbol.iterator]() {
        let chain;
        while ((chain = this.#pop()))
            yield chain;
    }
    #advance() {
        const desc = this.#descriptor(this.#avail_idx);
        const avail = (desc.flags & DescriptorFlags.AVAIL) !== 0;
        const used = (desc.flags & DescriptorFlags.USED) !== 0;
        if (avail === used || avail !== this.#avail_wrap)
            return null;
        const index = this.#avail_idx;
        this.#avail_idx += 1;
        if (this.#avail_idx >= this.#size) {
            this.#avail_idx = 0;
            this.#avail_wrap = !this.#avail_wrap;
        }
        return index;
    }
    #release(id, skip, written) {
        const desc = VirtqDescriptor.get(new DataView(this.#memory.buffer), this.#desc_addr + VirtqDescriptor.size * this.#used_idx);
        const avail = (desc.flags & DescriptorFlags.AVAIL) !== 0;
        const used = (desc.flags & DescriptorFlags.USED) !== 0;
        if (avail === used || avail !== this.#used_wrap) {
            throw new Error("ring full");
        }
        let flags = 0;
        if (this.#used_wrap)
            flags |= DescriptorFlags.AVAIL | DescriptorFlags.USED;
        if (written > 0)
            flags |= DescriptorFlags.WRITE;
        desc.id = id;
        desc.len = written;
        desc.flags = flags;
        this.#used_idx += skip;
        if (this.#used_idx >= this.#size) {
            this.#used_idx -= this.#size;
            this.#used_wrap = !this.#used_wrap;
        }
        this.#on_release();
    }
}
const transport_device = Symbol("virtio transport device");
/**
 * The device side of a virtio device: feature negotiation, virtqueues,
 * configuration space, and interrupts. A custom device constructs one with
 * a device ID and queue handlers, and attaches the resulting `device` to
 * the machine.
 */
export class VirtioController {
    /** The attachable device. */
    device;
    /** Pushes a new configuration to the guest and raises a config-change interrupt. */
    updateConfig;
    /** Closes the device. */
    close;
    /** Merges extra methods into the public device object; callable once. */
    expose;
    /** Creates a virtio device backed by `driver`. */
    constructor(options, driver) {
        const config = options.config?.slice() ?? new Uint8Array();
        let get_guest_config;
        let raise_config;
        let config_pending = false;
        let closed = false;
        let closing = false;
        let exposed = false;
        const close = () => {
            if (closed || closing)
                return;
            closing = true;
            try {
                driver.close?.(this);
            }
            finally {
                closed = true;
                closing = false;
            }
        };
        const endpoint = {
            device_id: options.deviceId,
            features: TransportFeatures.VERSION_1 |
                TransportFeatures.RING_PACKED |
                TransportFeatures.INDIRECT_DESC |
                (options.features ?? 0n),
            config,
            attach: (next_get_config, next_raise_config) => {
                assert(!closed && !closing, "cannot attach a closed virtio device");
                assert(!get_guest_config, "virtio device is already attached");
                next_get_config().set(config);
                get_guest_config = next_get_config;
                raise_config = next_raise_config;
                if (config_pending) {
                    config_pending = false;
                    raise_config();
                }
            },
            notify: (vq, queue) => {
                if (closed)
                    return;
                const handler = driver.queues[vq];
                assert(handler, `virtio device has no queue ${vq}`);
                return handler(queue, this);
            },
            close,
        };
        const device = {};
        Object.defineProperty(device, transport_device, { value: endpoint });
        this.device = device;
        this.updateConfig = (next_config) => {
            assert(next_config.byteLength === config.byteLength, "virtio config size cannot change");
            config.set(next_config);
            get_guest_config?.().set(config);
            if (closed)
                return;
            if (raise_config)
                raise_config();
            else
                config_pending = true;
        };
        this.close = close;
        this.expose = (api) => {
            assert(!exposed, "virtio device API is already exposed");
            exposed = true;
            Object.defineProperties(device, Object.getOwnPropertyDescriptors(api));
            return device;
        };
    }
}
export function virtio_device_description(device) {
    const transport = device[transport_device];
    return {
        device_id: transport.device_id,
        features: transport.features,
        config: transport.config,
    };
}
export function close_virtio_device(device) {
    device[transport_device].close();
}
export function virtio_imports({ memory, devices, trigger_irq, on_error, }) {
    const states = devices.map((device) => ({
        device: device[transport_device],
        queues: [],
    }));
    function queue_state(device, vq) {
        return (device.queues[vq] ??= {
            queue: undefined,
            pending: false,
            notifying: false,
        });
    }
    const drain_notifications = async (device, vq) => {
        const state = queue_state(device, vq);
        if (state.notifying || !state.queue)
            return;
        state.notifying = true;
        try {
            do {
                state.pending = false;
                await device.device.notify(vq, state.queue);
            } while (state.pending && state.queue);
        }
        catch (error) {
            on_error(error);
        }
        finally {
            state.notifying = false;
        }
    };
    return {
        set_features(dev, features) {
            const device = states[dev]?.device;
            assert(device);
            assert(device.features === features, "the kernel should accept every feature we offer, and no more");
        },
        enable_vring(dev, vq, size, desc_addr, irq) {
            const device = states[dev];
            assert(device);
            const state = queue_state(device, vq);
            // Interrupt once per synchronous batch of released chains.
            let armed = false;
            const queue = new PackedVirtqueue(memory, size, desc_addr >>> 0, () => {
                if (armed)
                    return;
                armed = true;
                queueMicrotask(() => {
                    armed = false;
                    if (state.queue === queue)
                        trigger_irq(irq);
                });
            });
            state.queue = queue;
            if (state.pending)
                void drain_notifications(device, vq);
        },
        disable_vring(dev, vq) {
            const device = states[dev];
            assert(device);
            const state = device.queues[vq];
            assert(state?.queue);
            state.queue = undefined;
        },
        setup(dev, config_irq, config_addr, config_len) {
            const address = config_addr >>> 0;
            const length = config_len >>> 0;
            const device = states[dev]?.device;
            assert(device);
            assert(length >= device.config.byteLength, "config space too small");
            device.attach(() => new Uint8Array(memory.buffer, address, length), () => trigger_irq(config_irq));
        },
        notify(dev, vq) {
            const device = states[dev];
            assert(device);
            queue_state(device, vq).pending = true;
            void drain_notifications(device, vq);
        },
    };
}
