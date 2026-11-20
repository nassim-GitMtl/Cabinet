import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildRow, duplicateKeys, guessMapping, parseBirthDate, parseSex, splitFullName } from "./mapping";
import { decodeText, parseSpreadsheet, readCsv } from "./parse";

const today = "2026-11-20";

describe("patient import: reading files", () => {
  it("reads CSV with ; or , delimiters, quotes, BOM and embedded newlines", () => {
    expect(readCsv('Nom;Prénom\n"BEN; SAID";"Karim ""K"""\n')).toEqual([["Nom", "Prénom"], ["BEN; SAID", 'Karim "K"']]);
    expect(readCsv("a,b\r\n1,\"x\ny\"")).toEqual([["a", "b"], ["1", "x\ny"]]);
    const sheet = parseSpreadsheet(strToU8("﻿Nom,Prénom\n\nHAMDI,Nour\n"));
    expect(sheet).toEqual({ headers: ["Nom", "Prénom"], rows: [["HAMDI", "Nour"]] });
  });

  it("decodes Windows-1256 Arabic CSV exported by Excel", () => {
    const bytes = new Uint8Array([0xC7, 0xE1, 0xE1, 0xDE, 0xC8, 0x0A, 0xE4, 0xE6, 0xD1]); // "اللقب\nنور" in cp1256
    expect(decodeText(bytes)).toBe("اللقب\nنور");
  });

  it("reads the first worksheet of an XLSX file with shared and inline strings", () => {
    const files = {
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Patients" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/sharedStrings.xml": strToU8("<sst><si><t>Nom</t></si><si><r><t>Pré</t></r><r><t>nom</t></r></si><si><t>Date de naissance</t></si><si><t>AÏT &amp; Fils</t></si></sst>"),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
        + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="inlineStr"><is><t>Lina</t></is></c><c r="D2"><v>31048</v></c></row></sheetData></worksheet>'),
    };
    const sheet = parseSpreadsheet(zipSync(files));
    expect(sheet.headers).toEqual(["Nom", "Prénom", "Date de naissance", "#4"]);
    expect(sheet.rows).toEqual([["AÏT & Fils", "Lina", "", "31048"]]);
  });
});

describe("patient import: mapping and values", () => {
  it("guesses columns in French, English and Arabic", () => {
    expect(guessMapping(["N° dossier", "Nom", "Prénom", "Téléphone", "Tél 2", "Date de naissance", "Sexe", "E-mail", "Ville", "Remarques"]))
      .toEqual({ legacyNumber: 0, lastName: 1, firstName: 2, phone: 3, phoneAlt: 4, birthDate: 5, sex: 6, email: 7, city: 8, notes: 9 });
    expect(guessMapping(["Nom complet", "Mobile", "DOB"])).toEqual({ fullName: 0, phone: 1, birthDate: 2 });
    expect(guessMapping(["اللقب", "الاسم", "رقم الهاتف", "تاريخ الميلاد"])).toEqual({ lastName: 0, firstName: 1, phone: 2, birthDate: 3 });
  });

  it("parses dates, sexes and full names the way Algerian lists write them", () => {
    expect(parseBirthDate("05/03/1985", today)).toEqual({ date: "1985-03-05", precision: "exact" });
    expect(parseBirthDate("5.3.85", today)).toEqual({ date: "1985-03-05", precision: "exact" });
    expect(parseBirthDate("1990", today)).toEqual({ date: "1990-01-01", precision: "year" });
    expect(parseBirthDate("31048", today)).toEqual({ date: "1985-01-01", precision: "exact" }); // Excel serial of 01/01/1985
    expect(parseBirthDate("31/02/1990", today)).toBe("invalid");
    expect(parseBirthDate("01/01/2030", today)).toBe("invalid");
    expect(parseSex("Femme")).toBe("female");
    expect(parseSex("ذكر")).toBe("male");
    expect(parseSex("X")).toBe("invalid");
    expect(parseSex("?")).toBeNull(); // punctuation only = not given
    expect(splitFullName("BENSAID Karim")).toEqual({ lastName: "BENSAID", firstName: "Karim" });
    expect(splitFullName("Karim BEN SAID")).toEqual({ lastName: "BEN SAID", firstName: "Karim" });
    expect(splitFullName("Bensaid Karim")).toEqual({ lastName: "Bensaid", firstName: "Karim" });
  });

  it("validates a row: names required, bad optional values dropped with a warning", () => {
    const mapping = { lastName: 0, firstName: 1, phone: 2, birthDate: 3, email: 4 };
    const ok = buildRow(["HAMDI", "Nour", "0555 00 11 22", "12/06/1990", "pas-un-email"], mapping, { today, countryCode: "DZ" });
    expect(ok.patient).toMatchObject({ lastName: "HAMDI", firstName: "Nour", phone: "+213555001122", birthDate: "1990-06-12", email: null });
    expect(ok.issues).toEqual([{ field: "email", code: "invalidEmail", level: "warning" }]);
    const missing = buildRow(["", "Nour", "", "", ""], mapping, { today, countryCode: "DZ" });
    expect(missing.issues).toContainEqual({ field: "name", code: "nameRequired", level: "error" });
    expect(duplicateKeys(ok.patient)).toEqual(["phone:+213555001122", "name:hamdi|nour|1990-06-12"]);
  });
});
