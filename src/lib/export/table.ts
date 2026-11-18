/**
 * Tabular export model shared by CSV and XLSX writers.
 * Money cells carry integer MINOR units plus the currency exponent so no float
 * arithmetic happens before formatting; dates are date-only "YYYY-MM-DD".
 */
export type ExportKind = "text" | "money" | "date" | "number";
export type ExportColumn = { header: string; kind: ExportKind };
export type ExportCell = string | number | null;
export type ExportSheet = { name: string; columns: ExportColumn[]; rows: ExportCell[][]; moneyExponent?: number };

/**
 * Spreadsheet formula injection guard (OWASP "CSV injection"): text starting
 * with = + - @ or a tab/CR could be executed as a formula when the file is
 * opened. Prefixing an apostrophe makes it inert text.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Minor units -> major-unit decimal string, e.g. 150050 (exp 2) -> "1500.50". */
export function minorToDecimal(minor: number, exponent: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  if (exponent === 0) return `${sign}${abs}`;
  const div = 10 ** exponent;
  return `${sign}${Math.floor(abs / div)}.${String(abs % div).padStart(exponent, "0")}`;
}

/** Safe file-name fragment. */
export function slugForFile(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
}
