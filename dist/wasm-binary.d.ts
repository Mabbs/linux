export interface WasmMemoryType {
    address: "i32" | "i64";
    minimum: bigint;
    maximum?: bigint;
    shared: boolean;
}
export interface WasmMemoryImport {
    module: string;
    name: string;
    type: WasmMemoryType;
}
export interface WasmMemories {
    imports: WasmMemoryImport[];
    definitions: WasmMemoryType[];
}
export declare class WasmParseError extends Error {
    constructor(message: string, offset: number);
}
export declare function read_wasm_memories(module: Uint8Array): WasmMemories;
