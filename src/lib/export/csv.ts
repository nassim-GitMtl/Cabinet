import { minorToDecimal, neutralizeFormula, type ExportSheet } from "./table";

/**
 * CSV for spreadsheet users in French/Algerian locales: semicolon separator,
 * decimal comma, UTF-8 with BOM (so Excel detects the encoding and Arabic
 * names display correctly), CRLF line endings, formula-injection guard.
 */
export function toCsv(sheet: ExportSheet, opts: { delimiter?: string; decimalComma?: boolean } = {}): string {
  const delimiter = opts.delimiter ?? ";";
  const decimalComma = opts.decimalComma ?? true;
  const exp = sheet.moneyExponent ?? 2;
  const quote = (v: string) => (v.includes(delimiter) || v.includes('"') || /[\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const cell = (value: string | number | null, kind: ExportSheet["columns"][number]["kind"]) => {
    if (value === null || value === undefined) return "";
    if (kind === "money" && typeof value === "number") {
      const s = minorToDecimal(value, exp);
      return decimalComma ? s.replace(".", ",") : s;
    }
    if (kind === "number" && typeof value === "number") return String(value);
    if (kind === "date" && typeof value === "string") {
      const [y, m, d] = value.split("-");
      return y && m && d ? `${d}/${m}/${y}` : value;
    }
    return quote(neutralizeFormula(String(value)));
  };
  const lines = [
    sheet.columns.map((c) => quote(neutralizeFormula(c.header))).join(delimiter),
    ...sheet.rows.map((row) => row.map((v, i) => cell(v, sheet.columns[i]?.kind ?? "text")).join(delimiter)),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
