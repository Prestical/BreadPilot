// pdfjs-dist ships no types for its worker module; extract.ts only hands it to pdfjs.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
