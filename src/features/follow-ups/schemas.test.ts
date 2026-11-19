import { describe, expect, it } from "vitest";
import { logContactSchema } from "./schemas";

const patientId = "01a1f3d8-d4b3-7c37-a201-574b4be3d324";
const appointmentId = "01a1f3d8-d4b3-7c37-a201-574b4be3d325";

describe("contact log input", () => {
  it("accepts what the follow-up buttons send (null for the unused reference)", () => {
    const parsed = logContactSchema.parse({ patientId, reason: "appointment_reminder", channel: "whatsapp", outcome: "message_prepared", appointmentId, treatmentPlanId: null });
    expect(parsed).toMatchObject({ appointmentId, treatmentPlanId: null, note: null });
    expect(logContactSchema.parse({ patientId, reason: "recall", channel: "phone", outcome: "reached", appointmentId: null, treatmentPlanId: null })).toMatchObject({ appointmentId: null });
  });

  it("requires the reference that matches the reason", () => {
    expect(logContactSchema.safeParse({ patientId, reason: "appointment_reminder", channel: "sms", outcome: "message_prepared", appointmentId: null, treatmentPlanId: null }).success).toBe(false);
    expect(logContactSchema.safeParse({ patientId, reason: "recall", channel: "sms", outcome: "reached", appointmentId, treatmentPlanId: null }).success).toBe(false);
  });
});
