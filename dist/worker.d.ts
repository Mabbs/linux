import { type MachineTerminationReason, type UserContext } from "./wasm.ts";
export interface InitMessage {
    type: "init";
    fn: number;
    arg: number;
    vmlinux: WebAssembly.Module;
    memory: WebAssembly.Memory;
    user: UserContext | null;
    /** One-shot user-memory copy result: 0 pending, 1 complete, negative errno. */
    user_copy_status: Int32Array<SharedArrayBuffer> | null;
}
export interface ForwardedInitMessage {
    type: "forwarded_init";
    port: MessagePort;
}
export type WorkerMessage = {
    type: "spawn_worker";
    name: string;
    port: MessagePort;
} | {
    type: "boot_console_write";
    message: ArrayBuffer;
} | {
    type: "boot_console_close";
} | {
    type: "terminate_machine";
    reason: MachineTerminationReason;
} | {
    type: "run_on_main";
    fn: number;
    arg: number;
} | {
    type: "worker_exit";
};
