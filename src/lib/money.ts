/**
 * Money is stored as integer minor units (e.g. centimes) together with an ISO
 * 4217 currency code. Never use floating point for amounts and never add
 * amounts of different currencies.
 */

export type Money = { amountMinor: number; currency: string };

const exponentCache = new Map<string, number>();

/** Number of minor-unit digits for a currency (DZD = 2). */
export function currencyExponent(currency: string): number {
  const cached = exponentCache.get(currency);
  if (cached !== undefined) return cached;
  const digits =
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  exponentCache.set(currency, digits);
  return digits;
}

function assertSafe(n: number) {
  if (!Number.isSafeInteger(n)) throw new RangeError("Amount exceeds safe integer range");
}

/**
 * Parses user input ("1 500", "1500,50", "1.500,5", "2500.75") into minor units
 * without floating point. Returns null for invalid input.
 * The LAST '.' or ',' followed by 1..exp digits is treated as the decimal separator.
 */
export function parseMoneyInput(input: string, currency: string): number | null {
  const exp = currencyExponent(currency);
  let s = input.trim().replace(/[\s  ']/g, "");
  if (!s) return null;
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;
  let intPart = s;
  let fracPart = "";
  const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  if (lastSep !== -1) {
    const tail = s.slice(lastSep + 1);
    if (tail.length >= 1 && tail.length <= exp) {
      intPart = s.slice(0, lastSep);
      fracPart = tail;
    }
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (!intPart && !fracPart) return null;
  const minor = Number(intPart || "0") * 10 ** exp + Number(fracPart.padEnd(exp, "0") || "0");
  assertSafe(minor);
  return negative ? -minor : minor;
}

/** Formats minor units for display. `symbol` overrides the currency code (e.g. "DA"). */
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale = "fr-DZ",
  symbol?: string,
): string {
  const exp = currencyExponent(currency);
  const major = amountMinor / 10 ** exp; // display only; exact for safe integers at these exponents
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(major);
  return `${number} ${symbol ?? currency}`;
}

/** Major-unit string for prefilling inputs, e.g. 150000 -> "1500.00". */
export function minorToInput(amountMinor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  if (exp === 0) return `${sign}${abs}`;
  const div = 10 ** exp;
  return `${sign}${Math.floor(abs / div)}.${String(abs % div).padStart(exp, "0")}`;
}

/** Sums amounts that must share one currency. Throws on a mix. */
export function sumMoney(items: Money[], currency: string): Money {
  let total = 0;
  for (const m of items) {
    if (m.currency !== currency) throw new Error(`Currency mismatch: ${m.currency} vs ${currency}`);
    total += m.amountMinor;
    assertSafe(total);
  }
  return { amountMinor: total, currency };
}

/**
 * Applies a percentage in basis points with banker-safe integer rounding
 * (round half away from zero). 1000 bp = 10%.
 */
export function applyBasisPoints(amountMinor: number, bp: number): number {
  const raw = (amountMinor * bp) / 10_000;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}
