// SPDX-License-Identifier: MIT
import { platform } from "./platform.js";
const supported_user_module_imports = new Set([
    "env\0memory\0memory",
    "linux\0syscall\0function",
    "linux\0get_thread_area\0function",
    "linux\0get_args_length\0function",
    "linux\0get_args\0function",
    "linux\0copy_siginfo\0function",
]);
/** Whether every import can be supplied when a userspace module is instantiated. */
export function user_module_imports_supported(module) {
    return WebAssembly.Module.imports(module).every(({ module, name, kind }) => supported_user_module_imports.has(`${module}\0${name}\0${kind}`));
}
/**
 * Allocates a shared memory, halving the maximum whenever the engine refuses
 * to reserve that much address space, degrading as far as the initial size.
 */
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
            const smaller_maximum = Math.max(initial_pages, Math.floor(maximum_pages / 2));
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
export function kernel_imports({ is_worker, memory, spawn_worker, boot_console_write, boot_console_close, terminate_machine, run_on_main, get_user_context, worker_exit, }) {
    return {
        breakpoint: () => {
            debugger;
        },
        halt_worker: () => {
            if (!is_worker)
                throw new Error("Halt called in main thread");
            // Messages posted after platform.quit() are not guaranteed to arrive.
            worker_exit();
            platform.quit();
            throw HALT_KERNEL;
        },
        terminate_machine: (reason) => {
            if (!is_worker) {
                throw new Error("Machine termination called in main thread");
            }
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
                            const copied = allocate_shared_memory(memory_pages, context.maximum_pages);
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
