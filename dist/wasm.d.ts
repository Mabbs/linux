export interface Instance extends WebAssembly.Instance {
    exports: {
        __indirect_function_table: WebAssembly.Table;
        boot(): void;
        trigger_irq(irq: number): void;
        syscall(nr: number, arg0: number, arg1: number, arg2: number, arg3: number, arg4: number, arg5: number): number;
        get_thread_area(): number;
        get_args_length(): number;
        get_args(buf: number): number;
    };
}
export interface UserContext {
    module: WebAssembly.Module;
    memory: WebAssembly.Memory;
    maximum_pages: number;
}
export declare function allocate_shared_memory(initial_pages: number, preferred_maximum_pages: number, allocate?: (descriptor: WebAssembly.MemoryDescriptor) => WebAssembly.Memory): {
    memory: WebAssembly.Memory;
    maximum_pages: number;
};
/** Values for the kernel.terminate_machine guest/host ABI. */
export declare enum MachineTerminationReason {
    Clean = 0,
    Panic = 1
}
export interface Imports {
    env: {
        memory: WebAssembly.Memory;
    };
    boot: {
        get_devicetree(buf: number, size: number): void;
        get_initramfs(buf: number, size: number): number;
    };
    kernel: {
        breakpoint(): void;
        halt_worker(): void;
        /** Reports that the whole machine ended, rather than only this worker. */
        terminate_machine(reason: MachineTerminationReason): void;
        boot_console_write(msg: number, len: number): void;
        boot_console_close(): void;
        return_address(_level: number): number;
        /** Unix time in nanoseconds, monotonically advancing during this session. */
        get_now_nsec(): bigint;
        get_stacktrace(buf: number, size: number): void;
        spawn_worker(fn: number, arg: number, comm: number, comm_len: number, user_memory: number): number;
        run_on_main(fn: number, arg: number): void;
    };
    user: {
        compile_begin(size: number): number;
        compile_write(buf: number, offset: number, size: number): number;
        compile_end(maximum_memory_pages: number): number;
        compile_abort(): void;
        instantiate(fresh_memory: number): void;
        call(): void;
        switch_entry(fn: number, arg: number): void;
        call_signal_handler(fn: number, sig: number): void;
        call_siginfo_handler(fn: number, sig: number, code: number, pid: number, uid: number, value: number, timerid: number, overrun: number): void;
        read(to: number, from: number, n: number): number;
        write(to: number, from: number, n: number): number;
        write_zeroes(to: number, n: number): number;
        futex_atomic_op(oldval: number, uaddr: number, op: number, oparg: number): number;
        futex_atomic_cmpxchg(oldval: number, uaddr: number, expected: number, replacement: number): number;
    };
    virtio: {
        set_features(dev: number, features: bigint): void;
        setup(dev: number, config_irq: number, config_addr: number, config_len: number): void;
        enable_vring(dev: number, vq: number, size: number, desc_addr: number, irq: number): void;
        disable_vring(dev: number, vq: number): void;
        notify(dev: number, vq: number): void;
    };
    jsexec: {
        run(code: number, code_len: number, result: number, result_size: number): number;
    };
}
export declare const HALT_KERNEL: unique symbol;
export declare function kernel_imports({ is_worker, memory, spawn_worker, boot_console_write, boot_console_close, terminate_machine, run_on_main, get_user_context, on_halt, }: {
    is_worker: boolean;
    memory: WebAssembly.Memory;
    spawn_worker: (fn: number, arg: number, name: string, user: UserContext | null) => void;
    boot_console_write: (message: ArrayBuffer) => void;
    boot_console_close: () => void;
    terminate_machine: (reason: MachineTerminationReason) => void;
    run_on_main: (fn: number, arg: number) => void;
    get_user_context: () => UserContext | null;
    on_halt?: () => void;
}): Imports["kernel"];
export declare function jsexec_imports({ memory, is_worker, delegate_to_main, }: {
    memory: WebAssembly.Memory;
    is_worker: boolean;
    delegate_to_main?: (code: string, result_ptr: number, result_size: number) => number;
}): Imports["jsexec"];
