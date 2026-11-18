import { strToU8, zipSync } from "fflate";
import { minorToDecimal, type ExportSheet } from "./table";

/**
 * Minimal, dependency-light XLSX (Office Open XML) writer.
 * - Text is written as inline strings: Excel never evaluates them as formulas.
 * - Money is a real number in major units with a 2-decimal format; dates are
 *   real Excel dates; the header row is bold and frozen.
 */

const xml = (s: string) =>
  s
    // Characters XML 1.0 forbids (control chars) are dropped.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Days since 1899-12-30 (Excel serial date) for a date-only string. */
function excelSerial(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

// Style indexes in styles.xml cellXfs: 0 default, 1 header (bold), 2 money, 3 date.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

function sheetXml(sheet: ExportSheet): string {
  const exp = sheet.moneyExponent ?? 2;
  const text = (ref: string, v: string, style = 0) => `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  const rows: string[] = [];
  rows.push(`<row r="1">${sheet.columns.map((c, i) => text(`${colName(i)}1`, c.header, 1)).join("")}</row>`);
  sheet.rows.forEach((row, r) => {
    const n = r + 2;
    const cells = row.map((v, i) => {
      const ref = `${colName(i)}${n}`;
      const kind = sheet.columns[i]?.kind ?? "text";
      if (v === null || v === undefined || v === "") return "";
      if (kind === "money" && typeof v === "number") return `<c r="${ref}" s="2"><v>${minorToDecimal(v, exp)}</v></c>`;
      if (kind === "number" && typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
      if (kind === "date" && typeof v === "string") {
        const serial = excelSerial(v);
        return serial === null ? text(ref, v) : `<c r="${ref}" s="3"><v>${serial}</v></c>`;
      }
      return text(ref, String(v));
    });
    rows.push(`<row r="${n}">${cells.join("")}</row>`);
  });
  const widths = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.kind === "text" ? 28 : 14}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths}</cols>
<sheetData>${rows.join("")}</sheetData>
</worksheet>`;
}

/** Excel sheet names: max 31 chars, no []:*?/\ and unique. */
function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim() || "Feuille";
  let candidate = base;
  for (let k = 2; used.has(candidate.toLowerCase()); k++) candidate = `${base.slice(0, 28)} ${k}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function toXlsx(sheets: ExportSheet[]): Uint8Array {
  const used = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, used));
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/styles.xml": strToU8(STYLES),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files, { level: 6 });
}
