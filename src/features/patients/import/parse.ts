// Reads a patient list from CSV or XLSX into a header row + string cells.
// No spreadsheet library: XLSX is a zip of XML parts (fflate is already used for exports).
import { unzipSync, strFromU8 } from "fflate";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 3000;

export type ParsedSheet = { headers: string[]; rows: string[][] };

export class ImportParseError extends Error {
  constructor(public readonly code: "unsupported" | "empty" | "tooManyRows" | "tooLarge") { super(code); }
}

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

export function parseSpreadsheet(bytes: Uint8Array): ParsedSheet {
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportParseError("tooLarge");
  const table = isZip(bytes) ? readXlsx(bytes) : readCsv(decodeText(bytes));
  // Drop fully empty rows, then take the first non-empty row as headers.
  const rows = table.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
  if (rows.length < 2) throw new ImportParseError("empty");
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new ImportParseError("tooManyRows");
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
  const headers = pad(rows[0]!).map((h, i) => h || `#${i + 1}`);
  return { headers, rows: rows.slice(1).map(pad) };
}

/**
 * UTF-8 first (with or without BOM). Excel "CSV" from an Arabic Windows is often Windows-1256, a French one
 * Windows-1252: pick 1256 when it yields Arabic letters.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    const arabic = new TextDecoder("windows-1256").decode(bytes);
    const arabicLetters = (arabic.match(/[؀-ۿ]/g) ?? []).length;
    return arabicLetters >= 3 ? arabic : new TextDecoder("windows-1252").decode(bytes);
  }
}

/** RFC 4180 CSV with delimiter detection (; , tab), quoted fields and embedded newlines. */
export function readCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [";", ",", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0]![1] > 0 ? counts[0]![0] : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()] ?? "";
  });

/** Text of every <t> inside a fragment (shared strings may be split into rich-text runs). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join("");

/** Column letters → zero-based index ("A" → 0, "AA" → 26). */
const columnIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

/** First worksheet of an XLSX file as rows of strings (numbers kept as typed, dates as Excel serials). */
export function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name.startsWith("xl/") });
  } catch {
    throw new ImportParseError("unsupported");
  }
  const workbook = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const rels = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "";
  const firstSheetRel = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = firstSheetRel ? rels.match(new RegExp(`<Relationship\\b[^>]*Id="${firstSheetRel}"[^>]*Target="([^"]+)"`))?.[1]
    ?? rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstSheetRel}"`))?.[1] : undefined;
  const sheetPath = target ? `xl/${target.replace(/^\/?xl\//, "").replace(/^\//, "")}` : "xl/worksheets/sheet1.xml";
  const sheet = files[sheetPath] ?? files["xl/worksheets/sheet1.xml"];
  if (!sheet) throw new ImportParseError("unsupported");
  const shared = files["xl/sharedStrings.xml"]
    ? [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!))
    : [];
  const rows: string[][] = [];
  for (const rowMatch of strFromU8(sheet).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of rowMatch[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const inner = c[2] ?? "";
      const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const value = type === "s" ? shared[Number(raw)] ?? ""
        : type === "inlineStr" ? textOf(inner)
        : raw !== undefined ? decodeXml(raw) : "";
      const index = ref ? columnIndex(ref) : row.length;
      row[index] = value;
    }
    rows.push(Array.from({ length: row.length }, (_, i) => row[i] ?? ""));
  }
  return rows;
}
