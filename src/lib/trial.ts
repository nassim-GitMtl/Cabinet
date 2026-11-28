/**
 * Free trial of a clinic subscription. `trial_ends_at` null = paid (or never on trial). Once the end has passed the
 * clinic stays readable (view, reports, exports) but every change is refused until the operator extends the trial
 * or converts the clinic to paid. Data is never deleted at the end of a trial.
 */
export type TrialState = {
  endsAt: Date | null;
  /** The clinic has a trial end date (running or over). */
  onTrial: boolean;
  expired: boolean;
  /** Whole days left, rounded up (1 on the last day); 0 once expired; null when not on trial. */
  daysLeft: number | null;
};

export const NO_TRIAL: TrialState = { endsAt: null, onTrial: false, expired: false, daysLeft: null };
export const DEFAULT_TRIAL_DAYS = 30;
export const MAX_TRIAL_DAYS = 120;
const DAY_MS = 86_400_000;

export function trialState(endsAt: Date | string | null | undefined, now: Date = new Date()): TrialState {
  if (!endsAt) return NO_TRIAL;
  const end = new Date(endsAt);
  const left = end.getTime() - now.getTime();
  if (left <= 0) return { endsAt: end, onTrial: true, expired: true, daysLeft: 0 };
  return { endsAt: end, onTrial: true, expired: false, daysLeft: Math.ceil(left / DAY_MS) };
}

/** New trial end when adding `days`: counted from the current end while it is still running, else from now. */
export function extendedTrialEnd(current: Date | string | null | undefined, days: number, now: Date = new Date()): Date {
  const base = current && new Date(current).getTime() > now.getTime() ? new Date(current) : now;
  return new Date(base.getTime() + days * DAY_MS);
}

/** Trial banner urgency: shown all along the trial, highlighted the last week. */
export function trialUrgent(state: TrialState): boolean {
  return state.expired || (state.daysLeft !== null && state.daysLeft <= 7);
}

/**
 * Trial given to a clinic that signs up by itself (/register). SIGNUP_TRIAL_DAYS sets it ("0" = none); when unset,
 * the hosted service (Vercel) gives DEFAULT_TRIAL_DAYS and a self-hosted server gives none (no operator to extend it).
 */
export function signupTrialDays(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env.SIGNUP_TRIAL_DAYS?.trim();
  if (raw) {
    const days = Number(raw);
    return Number.isInteger(days) && days > 0 && days <= MAX_TRIAL_DAYS ? days : null;
  }
  return env.VERCEL ? DEFAULT_TRIAL_DAYS : null;
}
