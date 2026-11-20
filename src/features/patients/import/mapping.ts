// Column mapping and row validation for patient imports (pure, unit-tested).
import { normalizePhone } from "@/lib/phone";

export const IMPORT_FIELDS = [
  "legacyNumber", "lastName", "firstName", "fullName", "lastNameAr", "firstNameAr", "sex", "birthDate",
  "phone", "phoneAlt", "email", "address", "city", "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** Field → column index in the file (absent = not imported). */
export type ImportMapping = Partial<Record<ImportField, number>>;

const SYNONYMS: Record<ImportField, string[]> = {
  legacyNumber: ["n dossier", "no dossier", "numero dossier", "num dossier", "dossier", "n", "no", "numero", "ref", "reference", "code", "code patient", "id", "file number", "file", "رقم الملف", "الرقم"],
  lastName: ["nom", "nom de famille", "last name", "lastname", "surname", "family name", "اللقب"],
  firstName: ["prenom", "first name", "firstname", "given name", "الاسم"],
  fullName: ["nom complet", "nom et prenom", "nom prenom", "patient", "nom du patient", "full name", "name", "الاسم الكامل", "الاسم واللقب", "اللقب والاسم"],
  lastNameAr: ["nom arabe", "nom en arabe", "nom ar", "arabic last name", "اللقب بالعربية"],
  firstNameAr: ["prenom arabe", "prenom en arabe", "prenom ar", "arabic first name", "الاسم بالعربية"],
  sex: ["sexe", "genre", "sex", "gender", "الجنس"],
  birthDate: ["date de naissance", "date naissance", "naissance", "ne le", "ddn", "birth date", "date of birth", "dob", "birthday", "تاريخ الميلاد", "تاريخ الازدياد"],
  phone: ["telephone", "tel", "tel 1", "telephone 1", "mobile", "portable", "gsm", "phone", "mobile phone", "الهاتف", "رقم الهاتف", "الجوال"],
  phoneAlt: ["telephone 2", "tel 2", "autre telephone", "fixe", "telephone fixe", "phone 2", "other phone", "الهاتف 2"],
  email: ["email", "e mail", "mail", "courriel", "adresse email", "البريد الالكتروني"],
  address: ["adresse", "address", "العنوان"],
  city: ["ville", "commune", "wilaya", "city", "town", "المدينة", "البلدية", "الولاية"],
  notes: ["notes", "note", "remarques", "remarque", "observations", "observation", "commentaire", "commentaires", "comments", "ملاحظات"],
};

/** Lowercase, no accents/diacritics, punctuation → spaces (Arabic letters kept). */
export function normalizeHeader(value: string): string {
  return value.normalize("NFD").replace(/[̀-ًͯ-ْ]/g, "").replace(/[إأآ]/g, "ا").replace(/ة/g, "ه")
    .toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
}
const SYN = Object.fromEntries(Object.entries(SYNONYMS).map(([k, v]) => [k, v.map(normalizeHeader)])) as Record<ImportField, string[]>;

/** Best guess: exact synonym first, then "header contains synonym"; one field per column. */
export function guessMapping(headers: string[]): ImportMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ImportMapping = {};
  const pick = (field: ImportField, test: (h: string, s: string) => boolean) => {
    if (mapping[field] !== undefined) return;
    const index = normalized.findIndex((h, i) => !used.has(i) && SYN[field].some((s) => test(h, s)));
    if (index >= 0) { mapping[field] = index; used.add(index); }
  };
  // Specific fields before generic ones ("telephone 2" before "telephone", "nom arabe" before "nom").
  const order: ImportField[] = ["phoneAlt", "lastNameAr", "firstNameAr", "fullName", "birthDate", "legacyNumber", "lastName", "firstName", "sex", "phone", "email", "address", "city", "notes"];
  for (const field of order) pick(field, (h, s) => h === s);
  for (const field of order) if (field !== "legacyNumber") pick(field, (h, s) => s.length >= 3 && h.includes(s));
  if (mapping.lastName !== undefined && mapping.firstName !== undefined) delete mapping.fullName;
  return mapping;
}

export type ImportIssue = { field: ImportField | "name"; code: string; level: "error" | "warning" };
export type ImportPatient = {
  legacyNumber: string | null; lastName: string; firstName: string; lastNameAr: string | null; firstNameAr: string | null;
  sex: "female" | "male" | null; birthDate: string | null; birthDatePrecision: "exact" | "year" | null;
  phone: string | null; phoneAlt: string | null; email: string | null; addressLine: string | null; city: string | null;
  administrativeNotes: string | null;
};

const MALE = ["m", "h", "homme", "masculin", "male", "man", "ذكر"];
const FEMALE = ["f", "femme", "feminin", "female", "woman", "انثى", "انثي"];

export function parseSex(raw: string): "female" | "male" | null | "invalid" {
  const v = normalizeHeader(raw);
  if (!v) return null;
  if (MALE.includes(v)) return "male";
  if (FEMALE.includes(v)) return "female";
  return "invalid";
}

/** DD/MM/YYYY, YYYY-MM-DD, a year alone, or an Excel serial number. Never in the future, never before 1900. */
export function parseBirthDate(raw: string, today: string): { date: string; precision: "exact" | "year" } | null | "invalid" {
  const v = raw.trim();
  if (!v) return null;
  let y: number, m: number, d: number;
  let precision: "exact" | "year" = "exact";
  let match: RegExpMatchArray | null;
  if ((match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = v.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/))) {
    const year = Number(match[3]);
    const shortCurrent = Number(today.slice(2, 4));
    y = match[3]!.length === 2 ? (year > shortCurrent ? 1900 + year : 2000 + year) : year;
    [d, m] = [Number(match[1]), Number(match[2])];
  } else if (/^\d{4}$/.test(v)) { [y, m, d] = [Number(v), 1, 1]; precision = "year"; }
  else if (/^\d{3,5}(?:\.\d+)?$/.test(v)) {
    // Excel serial date (days since 1899-12-30).
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86_400_000);
    [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else return "invalid";
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "invalid";
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (y < 1900 || iso > today) return "invalid";
  return { date: iso, precision };
}

/** "BENSAID Karim" → last = uppercase words; otherwise the first word is the last name ("Bensaid Karim"). */
export function splitFullName(full: string): { lastName: string; firstName: string } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { lastName: words[0] ?? "", firstName: "" };
  const upper = words.filter((w) => /[A-Z]/.test(w) && w === w.toUpperCase());
  if (upper.length && upper.length < words.length) {
    return { lastName: upper.join(" "), firstName: words.filter((w) => !upper.includes(w)).join(" ") };
  }
  return { lastName: words[0]!, firstName: words.slice(1).join(" ") };
}

const clip = (v: string, max: number) => (v.trim() ? v.trim().slice(0, max) : null);

/** One file row → patient values + issues. Errors block the row; warnings drop just the bad value. */
export function buildRow(raw: string[], mapping: ImportMapping, opts: { today: string; countryCode: string }): { patient: ImportPatient; issues: ImportIssue[] } {
  const get = (field: ImportField) => (mapping[field] === undefined ? "" : (raw[mapping[field]!] ?? "").trim());
  const issues: ImportIssue[] = [];
  let lastName = get("lastName");
  let firstName = get("firstName");
  if ((!lastName || !firstName) && get("fullName")) {
    const split = splitFullName(get("fullName"));
    lastName ||= split.lastName;
    firstName ||= split.firstName;
  }
  if (!lastName || !firstName) issues.push({ field: "name", code: "nameRequired", level: "error" });

  const sex = parseSex(get("sex"));
  if (sex === "invalid") issues.push({ field: "sex", code: "invalidSex", level: "warning" });
  const birth = parseBirthDate(get("birthDate"), opts.today);
  if (birth === "invalid") issues.push({ field: "birthDate", code: "invalidDate", level: "warning" });
  const phoneOf = (field: "phone" | "phoneAlt") => {
    const value = get(field);
    if (!value) return null;
    const normalized = normalizePhone(value, opts.countryCode);
    if (!normalized) issues.push({ field, code: "invalidPhone", level: "warning" });
    return normalized;
  };
  const phone = phoneOf("phone");
  const phoneAlt = phoneOf("phoneAlt");
  const emailRaw = get("email");
  const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw.slice(0, 200) : null;
  if (emailRaw && !email) issues.push({ field: "email", code: "invalidEmail", level: "warning" });

  return {
    patient: {
      legacyNumber: clip(get("legacyNumber"), 40),
      lastName: lastName.slice(0, 100), firstName: firstName.slice(0, 100),
      lastNameAr: clip(get("lastNameAr"), 100), firstNameAr: clip(get("firstNameAr"), 100),
      sex: sex === "invalid" ? null : sex,
      birthDate: birth && birth !== "invalid" ? birth.date : null,
      birthDatePrecision: birth && birth !== "invalid" ? birth.precision : null,
      phone, phoneAlt: phoneAlt !== phone ? phoneAlt : null, email,
      addressLine: clip(get("address"), 300), city: clip(get("city"), 100),
      administrativeNotes: clip(get("notes"), 2000),
    },
    issues,
  };
}

/** Weak key (names only): used when a row has neither phone nor birth date, so a re-import is still caught. */
export function nameOnlyKey(p: Pick<ImportPatient, "lastName" | "firstName">): string | null {
  return p.lastName && p.firstName ? `nameonly:${normalizeHeader(p.lastName)}|${normalizeHeader(p.firstName)}` : null;
}

/** Same person if same phone, or same last + first name and birth date (accent/case-insensitive). */
export function duplicateKeys(p: Pick<ImportPatient, "phone" | "lastName" | "firstName" | "birthDate">): string[] {
  const keys: string[] = [];
  if (p.phone) keys.push(`phone:${p.phone}`);
  if (p.lastName && p.firstName && p.birthDate) keys.push(`name:${normalizeHeader(p.lastName)}|${normalizeHeader(p.firstName)}|${p.birthDate}`);
  return keys;
}
