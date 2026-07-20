import { type VirtioDevice } from "./core.ts";
/** A MAC address as six bytes. */
export type MacAddress = readonly [number, number, number, number, number, number];
/**
 * One port on an Ethernet switch. Frames addressed to the port arrive at
 * the handler given to `addPort`.
 */
export interface EthernetPort {
    /** Injects a frame into the switch. */
    send(frame: Uint8Array): Promise<void>;
    /** Removes the port from the switch. */
    close(): void;
}
/** A learning Ethernet switch, created by `ethernetNetwork`. */
export interface EthernetNetwork {
    /** Adds a port; frames addressed to it arrive at `receive`. */
    addPort(receive: (frame: Uint8Array) => void | PromiseLike<void>): EthernetPort;
    /** Closes every port. */
    close(): void;
}
/** A small learning Ethernet switch. Unknown and multicast frames are flooded. */
export declare function ethernetNetwork(): EthernetNetwork;
/** A virtio-net NIC attached to an Ethernet network. */
export interface EthernetDevice extends VirtioDevice {
    /** The NIC's MAC address. */
    readonly macAddress: MacAddress;
}
/** Configuration for a virtio-net NIC. */
export interface EthernetDeviceOptions {
    /** Defaults to a random locally-administered address. */
    macAddress?: MacAddress;
}
/**
 * A virtio-net NIC attached to an Ethernet network. NICs on the same
 * network exchange ordinary Ethernet frames without any host TCP/IP
 * involvement.
 */
export declare function ethernetDevice(network: EthernetNetwork, { macAddress }?: EthernetDeviceOptions): EthernetDevice;
