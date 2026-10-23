// PDF → clean page text. Uses pdfjs-dist (pure JS, no native deps).
// Cleaning rules are tuned for Raspberry Pi documentation but are generic:
// repeated page headers/footers, table-of-contents dot leaders, and figure
// labels that pdfjs returns as spaced-out single letters are dropped.

import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PageText {
  page: number;
  lines: string[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export async function extractPdf(path: string): Promise<PageText[]> {
  const data = new Uint8Array(await readFile(path));
  const doc = await getDocument({ data, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  const pages: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const item of content.items) {
      if ("str" in item && item.str.trim()) items.push({ x: item.transform[4], y: item.transform[5], str: item.str });
    }
    pages.push({ page: i, lines: groupLines(items) });
  }
  await doc.destroy();
  return pages;
}

export interface TextItem {
  x: number;
  y: number;
  str: string;
}

/** Max baseline difference for items on the same visual line (subscripts like V_t sit ~2 units lower). */
const SAME_LINE = 3;

/** Rebuilds lines: items within SAME_LINE of a line's first baseline join it, ordered left to right. */
export function groupLines(items: TextItem[]): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; items: TextItem[] }[] = [];
  for (const it of sorted) {
    const last = lines.at(-1);
    if (last && last.y - it.y <= SAME_LINE) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  return lines.map((l) => norm(l.items.sort((a, b) => a.x - b.x).map((i) => i.str).join(" "))).filter(Boolean);
}

export interface TocEntry {
  number: string;
  title: string;
}

const TOC_RE = /^((?:\d+\.)+|Appendix [A-Z]\.|[A-Z]\.\d+\.)\s+(.+?)\s+(?:\.\s*){3,}\d+$/;

/** Table-of-contents entries (used to recognise section headings in the body). */
export function parseToc(pages: PageText[]): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const p of pages) {
    for (const line of p.lines) {
      const m = TOC_RE.exec(line);
      if (m) entries.push({ number: m[1]!, title: norm(m[2]!) });
    }
  }
  return entries;
}

/** Figure labels come out as "V B U S V S Y S": mostly single-character tokens. */
export function isGarbageLine(line: string): boolean {
  const tokens = line.split(" ");
  if (tokens.length < 5) return false;
  const singles = tokens.filter((t) => t.length === 1).length;
  return singles / tokens.length >= 0.6;
}

export function cleanPages(pages: PageText[]): PageText[] {
  // Lines that repeat on many pages (ignoring digits) are headers/footers.
  const counts = new Map<string, number>();
  for (const p of pages) {
    for (const key of new Set(p.lines.map((l) => l.replace(/\d+/g, "#")))) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.3));
  const repeated = (l: string) => (counts.get(l.replace(/\d+/g, "#")) ?? 0) >= threshold;
  const offset = footerOffset(pages);
  const footer = (l: string, page: PageText) => offset !== null && l === page.lines.at(-1) && trailingNumber(l) === page.page - offset;

  return pages
    .filter((p) => !p.lines.some((l) => /^Legal disclaimer notice$/i.test(l)))
    .map((p) => ({
      page: p.page,
      lines: p.lines.filter((l) => !repeated(l) && !footer(l, p) && !TOC_RE.test(l) && !isGarbageLine(l) && !/^Figure \d+ ?\.$/.test(l)),
    }))
    .filter((p) => p.lines.length > 0);
}

const trailingNumber = (l: string): number | null => {
  const m = /\s(\d{1,4})$/.exec(l);
  return m ? Number(m[1]) : null;
};

/**
 * Running footers are "<section name> <printed page number>", where the printed number is
 * the PDF page minus a fixed offset (title pages aren't numbered). A last line only counts
 * as a footer when its number fits the offset shared by at least half of the pages, so body
 * text that happens to end in a number is kept.
 */
export function footerOffset(pages: PageText[]): number | null {
  const votes = new Map<number, number>();
  for (const p of pages) {
    const n = trailingNumber(p.lines.at(-1) ?? "");
    if (n !== null) votes.set(p.page - n, (votes.get(p.page - n) ?? 0) + 1);
  }
  const [best, count] = [...votes].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return best !== null && count >= Math.max(2, pages.length / 2) ? best : null;
}

/** True when a PDF is essentially an image (e.g. the pinout diagram). */
export function isImageOnly(pages: PageText[]): boolean {
  const chars = pages.reduce((n, p) => n + p.lines.join(" ").length, 0);
  return chars / Math.max(1, pages.length) < 300;
}
