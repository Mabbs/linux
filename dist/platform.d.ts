export interface WorkerHandle {
    post(message: unknown): void;
    terminate(): Promise<void>;
}
export interface WorkerHandlers {
    on_message(message: unknown): void;
    on_error(error: Error): void;
}
/** A worker's connection back to the thread that spawned it. */
export interface WorkerChannel {
    post(message: unknown): void;
    on_message(handler: (message: unknown) => void): void;
}
interface Platform {
    load_wasm(url: URL): Promise<{
        bytes: Uint8Array<ArrayBuffer>;
        module: WebAssembly.Module;
    }>;
    spawn_worker(name: string, handlers: WorkerHandlers): WorkerHandle;
    worker_channel(): WorkerChannel;
    quit(): void;
}
export declare const platform: Platform;
export {};
