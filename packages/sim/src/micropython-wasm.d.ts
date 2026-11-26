// Types for the parts of @micropython/micropython-webassembly-pyscript (1.29.0-6) BreadPilot uses.
// The package ships none; these follow its micropython.mjs (loadMicroPython and the object it
// returns: FS, PyProxy, globals, pyimport, registerJsModule, runPython, runPythonAsync, repl*).
declare module "@micropython/micropython-webassembly-pyscript" {
  export interface LoadOptions {
    /** Path or URL of the .wasm file (micropython.wasm, or one of the other builds). */
    url?: string;
    heapsize?: number;
    stdout?: (text: string) => void;
    stderr?: (text: string) => void;
    /** Call stdout/stderr once per line instead of per chunk. */
    linebuffer?: boolean;
  }
  export interface MicroPython {
    runPython(code: string): unknown;
    runPythonAsync(code: string): Promise<unknown>;
    /** Emscripten's in-memory file system (where the simulator puts its Python modules). */
    FS: {
      writeFile(path: string, data: string | Uint8Array): void;
      readFile(path: string, opts?: { encoding: "utf8" }): string | Uint8Array;
      mkdir(path: string): void;
    };
    registerJsModule(name: string, module: object): void;
    pyimport(name: string): unknown;
    globals: { get(name: string): unknown; set(name: string, value: unknown): void };
  }
  export function loadMicroPython(options?: LoadOptions): Promise<MicroPython>;
}
