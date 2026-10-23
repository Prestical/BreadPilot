// Chunking: split by section headings, pack whole sentences into
// ~TARGET-sized chunks with a small overlap, and prefix every chunk with
// "<document> — <section>" so it still makes sense when retrieved on its own.

import type { PageText, TocEntry } from "./extract";

export type ChunkKind = "text" | "generated";

export interface Chunk {
  section: string | null;
  page: number | null;
  kind: ChunkKind;
  content: string;
}

/** Bump when chunk output changes: stored documents are re-indexed automatically. */
export const CHUNKER_VERSION = 2;
const TARGET = 1200;
const MAX = 1800;
const OVERLAP = 200;

interface Sentence {
  text: string;
  page: number;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** A line is a heading if it equals a TOC entry, or is the first line of a wrapped one. Exact matches win. */
export function headingOf(line: string, toc: TocEntry[]): string | null {
  const l = norm(line);
  const full = toc.map((e) => ({ e, text: `${e.number} ${e.title}` }));
  const exact = full.find((f) => f.text === l);
  if (exact) return exact.text;
  const wrapped = full.find((f) => f.text.startsWith(l) && l.startsWith(`${f.e.number} `) && l.length > f.e.number.length + 4);
  return wrapped?.text ?? null;
}

/** Splits into sentences, keeping numbers like "3.3 V" and "2.1." intact. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(•◦])|\s+(?=[•◦]\s)/)
    .map(norm)
    .filter(Boolean);
}

function pack(header: string, section: string | null, sentences: Sentence[], kind: ChunkKind): Chunk[] {
  // Long single "sentences" (tables, lists without punctuation) are hard-split first.
  const pieces = sentences.flatMap((s) =>
    s.text.length <= MAX ? [s] : Array.from({ length: Math.ceil(s.text.length / TARGET) }, (_, i) => ({ text: s.text.slice(i * TARGET, (i + 1) * TARGET), page: s.page })),
  );
  const chunks: Chunk[] = [];
  let current: Sentence[] = [];
  let fresh = 0; // sentences not yet written in any chunk
  const length = () => current.reduce((n, s) => n + s.text.length + 1, 0);

  const flush = () => {
    if (!fresh) return;
    // Cite the page of the first new sentence, not of the overlap carried from the previous chunk.
    const page = current[current.length - fresh]!.page;
    chunks.push({ section, page, kind, content: `${header}\n${current.map((s) => s.text).join(" ")}` });
    // Overlap: carry the last sentences (up to OVERLAP chars) into the next chunk.
    const carry: Sentence[] = [];
    for (let i = current.length - 1, n = 0; i > 0 && n + current[i]!.text.length <= OVERLAP; i--) {
      carry.unshift(current[i]!);
      n += current[i]!.text.length;
    }
    current = carry;
    fresh = 0;
  };

  for (const s of pieces) {
    if (fresh && length() + s.text.length > TARGET) flush();
    current.push(s);
    fresh++;
  }
  flush();
  return chunks;
}

/** Chunks cleaned PDF pages, section by section. */
export function chunkPages(pages: PageText[], toc: TocEntry[], docTitle: string): Chunk[] {
  const sections: { title: string | null; sentences: Sentence[] }[] = [{ title: null, sentences: [] }];
  for (const p of pages) {
    let buffer: string[] = [];
    const flushBuffer = () => {
      if (buffer.length) sections.at(-1)!.sentences.push(...splitSentences(buffer.join(" ")).map((text) => ({ text, page: p.page })));
      buffer = [];
    };
    for (const line of p.lines) {
      const heading = headingOf(line, toc);
      if (heading) {
        flushBuffer();
        sections.push({ title: heading, sentences: [] });
      } else buffer.push(line);
    }
    flushBuffer();
  }
  return sections.flatMap((s) => pack(s.title ? `${docTitle} — ${s.title}` : docTitle, s.title, s.sentences, "text"));
}

/**
 * Generated markdown (e.g. the verified pinout): one chunk per bullet under its "## " section.
 * Indented or plain lines continue the previous bullet; paragraphs become their own chunk.
 */
export function chunkMarkdown(md: string, docTitle: string): Chunk[] {
  const chunks: Chunk[] = [];
  let section = "Overview";
  let open: Chunk | null = null; // chunk that a continuation line extends
  const add = (text: string) => {
    open = { section, page: null, kind: "generated", content: `${docTitle} — ${section}\n${text}` };
    chunks.push(open);
  };
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line) {
      open = null;
      continue;
    }
    if (line.startsWith("# ")) continue;
    if (line.startsWith("## ")) {
      section = line.slice(3).trim();
      open = null;
    } else if (line.startsWith("- ")) add(line.slice(2));
    else if (open) (open as Chunk).content += ` ${line}`;
    else add(line);
  }
  return chunks;
}
