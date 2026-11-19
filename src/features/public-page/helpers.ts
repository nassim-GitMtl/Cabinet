// Pure helpers for the clinic public page: URL names, opening hours and safe external links.

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

/** "Cabinet Démo Les Oliviers (fictif)" → "cabinet-demo-les-oliviers-fictif". */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !slug.includes("--");
}

/** Only https links to the open web (no javascript:, data:, http:). */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

export type Range = { start: string; end: string };

/**
 * Clinic opening hours from clinicians' weekly hours: per ISO weekday (1 = Monday … 7 = Sunday),
 * the union of everyone's ranges, so overlapping or touching ranges merge into one.
 */
export function mergeWeeklyHours(rows: { weekday: number; start: string; end: string }[]): Record<number, Range[]> {
  const out: Record<number, Range[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  for (let day = 1; day <= 7; day++) {
    const ranges = rows.filter((r) => r.weekday === day).map((r) => ({ start: r.start.slice(0, 5), end: r.end.slice(0, 5) }))
      .sort((a, b) => a.start.localeCompare(b.start));
    for (const r of ranges) {
      const last = out[day]!.at(-1);
      if (last && r.start <= last.end) last.end = r.end > last.end ? r.end : last.end;
      else out[day]!.push({ ...r });
    }
  }
  return out;
}

/** Display order for an Algerian week (Sunday first). */
export const WEEK_ORDER = [7, 1, 2, 3, 4, 5, 6] as const;
