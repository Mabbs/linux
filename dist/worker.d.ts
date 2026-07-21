import { type MachineTerminationReason, type UserContext } from "./wasm.ts";
export interface InitMessage {
    fn: number;
    arg: number;
    vmlinux: WebAssembly.Module;
    memory: WebAssembly.Memory;
    user: UserContext | null;
}
export type WorkerMessage = {
    type: "spawn_worker";
    fn: number;
    arg: number;
    name: string;
    user: UserContext | null;
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
    type: "jsexec_run";
    code: string;
    resultPtr: number;
    resultSize: number;
    sab: SharedArrayBuffer;
} | {
    type: "worker_exit";
};
