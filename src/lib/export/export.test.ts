import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { minorToDecimal, neutralizeFormula, type ExportSheet } from "./table";
import { toXlsx } from "./xlsx";

const sheet: ExportSheet = {
  name: "Factures: [test]/1",
  columns: [
    { header: "Patient", kind: "text" },
    { header: "Date", kind: "date" },
    { header: "Montant", kind: "money" },
    { header: "Qté", kind: "number" },
  ],
  rows: [
    ["=HYPERLINK(\"http://evil\")", "2026-11-18", 150050, 2],
    ["Benali; \"Yacine\"", "2026-01-02", -100, 1],
    ["بن علي", null, 0, null],
  ],
};

describe("exports", () => {
  it("neutralizes spreadsheet formulas", () => {
    for (const v of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) expect(neutralizeFormula(v).startsWith("'")).toBe(true);
    expect(neutralizeFormula("Benali")).toBe("Benali");
  });
  it("formats money from minor units without floats", () => {
    expect(minorToDecimal(150050, 2)).toBe("1500.50");
    expect(minorToDecimal(-5, 2)).toBe("-0.05");
  });
  it("writes French-Excel CSV with BOM, semicolons, decimal comma and quoting", () => {
    const csv = toCsv(sheet);
    expect(csv.startsWith("﻿Patient;Date;Montant;Qté\r\n")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")";18/11/2026;1500,50;2`);
    expect(csv).toContain(`"Benali; ""Yacine""";02/01/2026;-1,00;1`);
    expect(csv).toContain("بن علي;;0,00;");
  });
  it("writes a valid XLSX with inline strings, numeric money and real dates", () => {
    const files = unzipSync(toXlsx([sheet]));
    expect(Object.keys(files)).toContain("xl/worksheets/sheet1.xml");
    const wb = strFromU8(files["xl/workbook.xml"]!);
    expect(wb).toContain('name="Factures   test  1"');
    const ws = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(ws).toContain('t="inlineStr"');
    expect(ws).not.toContain("<f>"); // no formulas anywhere
    expect(ws).toContain('<c r="C2" s="2"><v>1500.50</v></c>');
    expect(ws).toContain('<c r="B2" s="3"><v>46344</v></c>');
  });
});
