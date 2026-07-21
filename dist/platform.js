// SPDX-License-Identifier: MIT
// The seam between web APIs (browsers) and node builtins (node, deno).
// Selected at runtime by the presence of process.getBuiltinModule, so bundlers
// only ever see the web path and never try to resolve node builtins.
import { assert } from "./util.js";
const web = {
    async load_wasm(url) {
        const response = await fetch(url);
        // native code caching is only supported with the *Streaming functions, so use it:
        const module = await WebAssembly.compileStreaming(response.clone());
        const bytes = new Uint8Array(await response.arrayBuffer());
        return { bytes, module };
    },
    spawn_worker(name, handlers) {
        const worker = new Worker(new URL("./worker.js", import.meta.url), {
            type: "module",
            name,
        });
        worker.onmessage = (event) => handlers.on_message(event.data);
        worker.onerror = (event) => {
            event.preventDefault();
            handlers.on_error(event.error instanceof Error
                ? event.error
                : new Error(event.message || "machine worker failed"));
        };
        return {
            post: (message, transfer) => worker.postMessage(message, transfer ?? []),
            terminate: async () => worker.terminate(),
        };
    },
    worker_channel() {
        return {
            post: (message, transfer) => self.postMessage(message, transfer ?? []),
            on_message: (handler) => {
                self.onmessage = (event) => handler(event.data);
            },
        };
    },
    quit() {
        self.close();
    },
};
function node(getBuiltinModule, process) {
    const { readFile } = getBuiltinModule("node:fs/promises");
    const { Worker, parentPort } = getBuiltinModule("node:worker_threads");
    return {
        async load_wasm(url) {
            const bytes = await readFile(url);
            return { bytes, module: await WebAssembly.compile(bytes) };
        },
        spawn_worker(name, handlers) {
            const worker = new Worker(new URL("./worker.js", import.meta.url), {
                name,
            });
            worker.on("message", handlers.on_message);
            worker.on("error", handlers.on_error);
            return {
                post: (message, transfer) => worker.postMessage(message, transfer),
                terminate: async () => void await worker.terminate(),
            };
        },
        worker_channel() {
            assert(parentPort, "not in a worker");
            return {
                post: (message, transfer) => parentPort.postMessage(message, transfer),
                on_message: (handler) => parentPort.on("message", handler),
            };
        },
        quit() {
            process.exit(0);
        },
    };
}
const process = globalThis.process;
const getBuiltinModule = process?.getBuiltinModule;
export const platform = getBuiltinModule && process
    ? node(getBuiltinModule, process)
    : web;
