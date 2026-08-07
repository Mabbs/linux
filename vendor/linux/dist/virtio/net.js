// SPDX-License-Identifier: MIT
import { Bytes, FixedArray, Struct, U16BE, U16LE, U8 } from "../bytes.js";
import { assert } from "../util.js";
import { VirtioController, } from "./core.js";
// Modern virtio-net always uses virtio_net_hdr_mrg_rxbuf, even when the
// mergeable-buffer feature itself is not offered.
const MAX_PENDING_FRAMES = 256;
class VirtioNetHeader extends Struct({
    flags: U8,
    gso_type: U8,
    header_length: U16LE,
    gso_size: U16LE,
    checksum_start: U16LE,
    checksum_offset: U16LE,
    buffer_count: U16LE,
}) {
}
const Mac = FixedArray(U8, 6);
class EthernetHeader extends Struct({
    destination: Mac,
    source: Mac,
    type: U16BE,
}) {
}
function mac_key(address) {
    return Array.from(address, (byte) => byte.toString(16).padStart(2, "0")).join(":");
}
function is_multicast(address) {
    return (address[0] & 1) !== 0;
}
/** A small learning Ethernet switch. Unknown and multicast frames are flooded. */
export function ethernetNetwork() {
    const ports = new Set();
    const learned = new Map();
    let closed = false;
    function addPort(receive) {
        assert(!closed, "cannot add a port to a closed Ethernet network");
        const port = { receive, closed: false };
        ports.add(port);
        return {
            async send(frame) {
                if (closed)
                    return;
                assert(!port.closed, "cannot send from a closed Ethernet port");
                assert(frame.byteLength >= EthernetHeader.size, "Ethernet frame is shorter than its header");
                const header = new EthernetHeader(frame);
                learned.set(mac_key(header.source), port);
                const destination = learned.get(mac_key(header.destination));
                const recipients = destination && !is_multicast(header.destination)
                    ? destination === port || destination.closed ? [] : [destination]
                    : Array.from(ports, (candidate) => candidate !== port && !candidate.closed
                        ? candidate
                        : undefined).filter((candidate) => !!candidate);
                await Promise.all(recipients.map((recipient) => recipient.receive(frame.slice())));
            },
            close() {
                if (port.closed)
                    return;
                port.closed = true;
                ports.delete(port);
                for (const [mac, owner] of learned) {
                    if (owner === port)
                        learned.delete(mac);
                }
            },
        };
    }
    return {
        addPort,
        close() {
            if (closed)
                return;
            closed = true;
            for (const port of ports)
                port.closed = true;
            ports.clear();
            learned.clear();
        },
    };
}
function random_mac() {
    const address = crypto.getRandomValues(new Uint8Array(6));
    address[0] = (address[0] | 0x02) & 0xfe;
    return Array.from(address);
}
function copy_packet(chain, packet) {
    let offset = 0;
    for (const descriptor of chain) {
        assert(descriptor.writable, "virtio-net receive descriptor must be writable");
        const length = Math.min(packet.byteLength - offset, descriptor.array.byteLength);
        if (length > 0)
            descriptor.array.set(packet.subarray(offset, offset + length));
        offset += length;
    }
    assert(offset === packet.byteLength, "virtio-net receive buffer is too small");
    chain.release(offset);
}
/**
 * A virtio-net NIC attached to an Ethernet network. NICs on the same
 * network exchange ordinary Ethernet frames without any host TCP/IP
 * involvement.
 */
export function ethernetDevice(network, { macAddress = random_mac() } = {}) {
    assert(macAddress.length === 6 &&
        macAddress.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255), "invalid MAC address");
    const receive_buffers = [];
    const pending_frames = [];
    let controller;
    function flush_receive() {
        while (receive_buffers.length > 0 && pending_frames.length > 0) {
            const frame = pending_frames.shift();
            const packet = new Bytes(VirtioNetHeader.size + frame.byteLength);
            packet.alloc(VirtioNetHeader).value = {
                flags: 0,
                gso_type: 0,
                header_length: 0,
                gso_size: 0,
                checksum_start: 0,
                checksum_offset: 0,
                buffer_count: 1,
            };
            packet.append(frame);
            copy_packet(receive_buffers.shift(), packet.array);
        }
    }
    const port = network.addPort((frame) => {
        if (pending_frames.length === MAX_PENDING_FRAMES)
            pending_frames.shift();
        pending_frames.push(frame.slice());
        flush_receive();
    });
    function receive(queue) {
        for (const chain of queue)
            receive_buffers.push(chain);
        flush_receive();
    }
    async function transmit(queue, controller) {
        for (const chain of queue) {
            const chunks = [];
            let length = 0;
            for (const descriptor of chain) {
                assert(!descriptor.writable, "virtio-net transmit descriptor must be readable");
                chunks.push(descriptor.array);
                length += descriptor.array.byteLength;
            }
            assert(length >= VirtioNetHeader.size, "short virtio-net transmit header");
            const frame = new Bytes(length - VirtioNetHeader.size);
            let source_offset = VirtioNetHeader.size;
            for (const chunk of chunks) {
                if (source_offset >= chunk.byteLength) {
                    source_offset -= chunk.byteLength;
                    continue;
                }
                frame.append(chunk.subarray(source_offset));
                source_offset = 0;
            }
            assert(frame.length === frame.capacity, "short virtio-net transmit frame");
            await port.send(frame.array);
            chain.release(0);
        }
    }
    const config = Uint8Array.from(macAddress);
    controller = new VirtioController({ deviceId: 1, features: 1n << 5n, config }, {
        queues: [receive, transmit],
        close() {
            port.close();
            receive_buffers.length = 0;
            pending_frames.length = 0;
        },
    });
    return controller.expose({ macAddress });
}
