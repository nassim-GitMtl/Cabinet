export type ParsedInventoryScan = {
  raw: string;
  productCode: string;
  lotNumber: string | null;
  expiresOn: string | null;
  gs1: boolean;
};

function gs1Expiry(value: string): string | null {
  if (!/^\d{6}$/.test(value)) return null;
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  let day = Number(value.slice(4, 6));
  if (month < 1 || month > 12) return null;
  if (day === 0) day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parses the GS1 fields useful to inventory: GTIN (01), expiry (17), and lot (10). */
export function parseInventoryScan(input: string): ParsedInventoryScan {
  const raw = input.trim().replace(/^\][A-Za-z][0-9]/, "");
  let productCode = raw;
  let lotNumber: string | null = null;
  let expiresOn: string | null = null;
  let gs1 = false;

  const parenthesized = [...raw.matchAll(/\((01|17|10)\)([^()]*)/g)];
  if (parenthesized.length) {
    gs1 = true;
    for (const match of parenthesized) {
      const value = match[2]!.trim();
      if (match[1] === "01" && /^\d{14}$/.test(value.slice(0, 14))) productCode = value.slice(0, 14);
      if (match[1] === "17") expiresOn = gs1Expiry(value.slice(0, 6));
      if (match[1] === "10") lotNumber = value.slice(0, 100) || null;
    }
  } else if (/^01\d{14}/.test(raw)) {
    gs1 = true;
    productCode = raw.slice(2, 16);
    let cursor = 16;
    while (cursor < raw.length) {
      if (raw.startsWith("17", cursor) && /^\d{6}/.test(raw.slice(cursor + 2))) {
        expiresOn = gs1Expiry(raw.slice(cursor + 2, cursor + 8));
        cursor += 8;
      } else if (raw.startsWith("10", cursor)) {
        const end = raw.indexOf("\u001d", cursor + 2);
        lotNumber = raw.slice(cursor + 2, end === -1 ? undefined : end).slice(0, 100) || null;
        cursor = end === -1 ? raw.length : end + 1;
      } else {
        const separator = raw.indexOf("\u001d", cursor);
        cursor = separator === -1 ? raw.length : separator + 1;
      }
    }
  }

  return { raw, productCode, lotNumber, expiresOn, gs1 };
}
