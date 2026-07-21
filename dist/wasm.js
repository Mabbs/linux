// SPDX-License-Identifier: MIT
import { platform } from "./platform.js";
const MINIMUM_BACKOFF_MAXIMUM_PAGES = 8192; // 512 MiB
// Cap the maximum of each forked (COPY) process's memory well below the
// parent's maximum.  Every non-CLONE_VM fork allocates a brand-new shared
// WebAssembly.Memory whose `maximum` reserves address space in the browser.
// With the parent's 512 MiB maximum, ~180 forks exhaust Safari's address
// space.  128 MiB per forked process is ample for busybox-class commands
// while allowing ~4x more concurrent forks before exhaustion.
const USER_COPY_MAXIMUM_PAGES = 0x800; // 128 MiB
export function allocate_shared_memory(initial_pages, preferred_maximum_pages, allocate = (descriptor) => new WebAssembly.Memory(descriptor)) {
    let maximum_pages = preferred_maximum_pages;
    for (;;) {
        try {
            return {
                memory: allocate({
                    initial: initial_pages,
                    maximum: maximum_pages,
                    shared: true,
                }),
                maximum_pages,
            };
        }
        catch (error) {
            const smaller_maximum = Math.max(initial_pages, MINIMUM_BACKOFF_MAXIMUM_PAGES, Math.floor(maximum_pages / 2));
            if (!(error instanceof RangeError) || smaller_maximum >= maximum_pages) {
                throw error;
            }
            maximum_pages = smaller_maximum;
        }
    }
}
const WASM_USER_MEMORY_NONE = 0;
const WASM_USER_MEMORY_SHARE = 1;
const WASM_USER_MEMORY_COPY = 2;
/** Values for the kernel.terminate_machine guest/host ABI. */
export var MachineTerminationReason;
(function (MachineTerminationReason) {
    MachineTerminationReason[MachineTerminationReason["Clean"] = 0] = "Clean";
    MachineTerminationReason[MachineTerminationReason["Panic"] = 1] = "Panic";
})(MachineTerminationReason || (MachineTerminationReason = {}));
export const HALT_KERNEL = Symbol("halt kernel");
export function kernel_imports({ is_worker, memory, spawn_worker, boot_console_write, boot_console_close, terminate_machine, run_on_main, get_user_context, on_halt, }) {
    return {
        breakpoint: () => {
            debugger;
        },
        halt_worker: () => {
            if (!is_worker)
                throw new Error("Halt called in main thread");
            on_halt?.();
            platform.quit();
            throw HALT_KERNEL;
        },
        terminate_machine: (reason) => {
            if (!is_worker)
                throw new Error("Machine termination called in main thread");
            terminate_machine(reason);
            throw HALT_KERNEL;
        },
        boot_console_write: (msg, len) => {
            const address = msg >>> 0;
            const length = len >>> 0;
            boot_console_write(new Uint8Array(memory.buffer, address, length).slice().buffer);
        },
        boot_console_close,
        return_address: (_level) => {
            return 0;
        },
        get_now_nsec: () => {
            /*
              The more straightforward way to do this is
              `BigInt(Math.round(performance.now() * 1_000_000))`.
              Below is semantically identical but has less floating point
              inaccuracy.
              `performance.now()` has 5μs precision in the browser.
              In server runtimes it has full nanosecond precision, but this code
              rounds to the same 5μs precision.
            */
            return BigInt(Math.round((performance.now() + performance.timeOrigin) * 200)) * 5000n;
        },
        get_stacktrace: (buf, size) => {
            const address = buf >>> 0;
            const capacity = size >>> 0;
            // 5 lines: strip Error, strip 4 common lines of stack
            const trace = new TextEncoder().encode(new Error().stack?.split("\n").slice(5).join("\n"));
            if (trace.byteLength > capacity && capacity >= 3) {
                /// 46 = "."
                trace[capacity - 1] = 46;
                trace[capacity - 2] = 46;
                trace[capacity - 3] = 46;
            }
            new Uint8Array(memory.buffer).set(trace.subarray(0, capacity), address);
        },
        spawn_worker: (fn, arg, comm, comm_len, user_memory) => {
            const comm_address = comm >>> 0;
            const comm_length = comm_len >>> 0;
            const name = new TextDecoder().decode(new Uint8Array(memory.buffer, comm_address, comm_length).slice());
            let user = null;
            if (user_memory !== WASM_USER_MEMORY_NONE) {
                const context = get_user_context();
                if (!context)
                    return -22; // invalid argument
                const memory_pages = context.memory.buffer.byteLength / 0x10000;
                switch (user_memory) {
                    case WASM_USER_MEMORY_SHARE:
                        user = context;
                        break;
                    case WASM_USER_MEMORY_COPY:
                        try {
                            const copy_maximum = Math.max(memory_pages, Math.min(context.maximum_pages, USER_COPY_MAXIMUM_PAGES));
                            const copied = allocate_shared_memory(memory_pages, copy_maximum);
                            new Uint8Array(copied.memory.buffer).set(new Uint8Array(context.memory.buffer));
                            user = {
                                module: context.module,
                                ...copied,
                            };
                        }
                        catch {
                            return -12; // out of memory
                        }
                        break;
                    default:
                        return -22; // invalid argument
                }
            }
            spawn_worker(fn, arg, name, user);
            return 0;
        },
        run_on_main,
    };
}
export function jsexec_imports({ memory, is_worker, delegate_to_main, }) {
    return {
        run(code, code_len, result, result_size) {
            const mem = new Uint8Array(memory.buffer);
            // Copy from shared memory into a regular ArrayBuffer first,
            // because TextDecoder rejects views of SharedArrayBuffer.
            const codeBytes = new Uint8Array(code_len);
            codeBytes.set(mem.subarray(code, code + code_len));
            const codeStr = new TextDecoder().decode(codeBytes);
            // Workers don't have access to window/DOM — delegate eval to the
            // main thread via Atomics + postMessage for synchronous cross-thread
            // communication.
            if (is_worker && delegate_to_main) {
                return delegate_to_main(codeStr, result, result_size);
            }
            let resultStr;
            try {
                // eslint-disable-next-line no-eval
                const value = eval(codeStr);
                resultStr = value === undefined ? "undefined" : String(value);
            }
            catch (e) {
                resultStr = `Error: ${e instanceof Error ? e.message : String(e)}`;
            }
            const resultBytes = new TextEncoder().encode(resultStr);
            const len = Math.min(resultBytes.length, result_size);
            mem.set(resultBytes.subarray(0, len), result);
            return len;
        },
    };
}
