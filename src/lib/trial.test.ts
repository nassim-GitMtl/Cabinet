import { describe, expect, it } from "vitest";
import { extendedTrialEnd, signupTrialDays, trialState, trialUrgent } from "./trial";

const now = new Date("2026-11-28T10:00:00Z");
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe("clinic trial", () => {
  it("counts whole days left and expires at the end time", () => {
    expect(trialState(null, now)).toEqual({ endsAt: null, onTrial: false, expired: false, daysLeft: null });
    expect(trialState(inHours(30 * 24), now)).toMatchObject({ onTrial: true, expired: false, daysLeft: 30 });
    expect(trialState(inHours(2), now)).toMatchObject({ expired: false, daysLeft: 1 });
    expect(trialState(inHours(0), now)).toMatchObject({ expired: true, daysLeft: 0 });
    expect(trialState(inHours(-48).toISOString(), now)).toMatchObject({ expired: true, daysLeft: 0 });
    expect(trialUrgent(trialState(inHours(8 * 24), now))).toBe(false);
    expect(trialUrgent(trialState(inHours(7 * 24), now))).toBe(true);
    expect(trialUrgent(trialState(null, now))).toBe(false);
  });

  it("extends from the current end while running, from now once over", () => {
    expect(extendedTrialEnd(inHours(24), 14, now)).toEqual(inHours(24 + 14 * 24));
    expect(extendedTrialEnd(inHours(-24), 14, now)).toEqual(inHours(14 * 24));
    expect(extendedTrialEnd(null, 30, now)).toEqual(inHours(30 * 24));
  });

  it("gives self-signed-up clinics a trial on the hosted service only, unless configured", () => {
    expect(signupTrialDays({})).toBeNull();
    expect(signupTrialDays({ VERCEL: "1" })).toBe(30);
    expect(signupTrialDays({ VERCEL: "1", SIGNUP_TRIAL_DAYS: "14" })).toBe(14);
    expect(signupTrialDays({ SIGNUP_TRIAL_DAYS: "0" })).toBeNull();
    expect(signupTrialDays({ SIGNUP_TRIAL_DAYS: "abc" })).toBeNull();
  });
});
