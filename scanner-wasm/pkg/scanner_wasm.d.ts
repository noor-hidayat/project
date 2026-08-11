/* tslint:disable */
/* eslint-disable */

/**
 * Decode barcode 1D dari buffer RGBA (matches `<canvas>.getImageData()`).
 * Cepat: hints normal. Mengembalikan `None` jika tidak terbaca.
 */
export function decode_rgba(width: number, height: number, data: Uint8Array): string | undefined;

/**
 * Decode dengan TRY_HARDER + juga coba citra inverted (biaya lebih mahal).
 */
export function decode_rgba_hard(width: number, height: number, data: Uint8Array): string | undefined;

/**
 * Hanya untuk smoke-test: encode barcode (via rxing writer) menjadi RGBA,
 * lalu bisa di-decode ulang oleh `decode_rgba`. Fitur `dev-encoder`.
 */
export function encode_test_rgba(format: string, text: string, width: number, height: number): Uint8Array;

/**
 * Pasang panic hook agar pesan panic wasm tampil di console (memudahkan debug).
 */
export function init(): void;

/**
 * Versi string untuk memudahkan debug / smoke test dari konsol.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly decode_rgba: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decode_rgba_hard: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encode_test_rgba: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly init: () => void;
    readonly version: (a: number) => void;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
