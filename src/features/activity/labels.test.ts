import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fr from "../../../messages/fr.json";

/** Every audit action written by the code must have a readable label in the activity log. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Actions built from a variable, with every value the variable can take. */
const TEMPLATES: Record<string, string[]> = {
  "staff.${status}": ["staff.active", "staff.deactivated"],
  "sterilization.${kind}_deactivated": ["sterilization.sterilizer_deactivated", "sterilization.instrument_set_deactivated"],
  "sterilization.cycle_${status}": ["sterilization.cycle_released", "sterilization.cycle_failed"],
  "health_history.${outcome}": ["health_history.reviewed", "health_history.no_changes"],
  "treatment_plan.${input.decision}": ["treatment_plan.accepted", "treatment_plan.declined"],
  "shared_profile.consent_${decision}": ["shared_profile.consent_approved", "shared_profile.consent_declined"],
  "appointment.${kind}": ["appointment.cancelled", "appointment.no_show"],
};

describe("activity log labels", () => {
  const root = path.join(process.cwd(), "src");
  const files = sources(root).map((f) => readFileSync(f, "utf8"));
  const labels = (fr as unknown as { activity: { actions: Record<string, string> } }).activity.actions;

  it("labels every action code used by the services", () => {
    const actions = new Set<string>();
    for (const text of files) {
      for (const m of text.matchAll(/action:/g)) {
        const chunk = text.slice(m.index! + 7, m.index! + 167).split(/,\s*(?:entityType|entityId|organizationId|metadata|patientId|actorType)\b/)[0]!;
        for (const lit of chunk.matchAll(/"([a-z_]+(?:\.[a-z_]+)+)"/g)) actions.add(lit[1]!);
        const template = chunk.match(/^\s*`([^`]+)`/);
        if (template) {
          const values = TEMPLATES[template[1]!];
          expect(values, `new action template ${template[1]}: list its values in TEMPLATES`).toBeDefined();
          values!.forEach((v) => actions.add(v));
        }
      }
    }
    expect(actions.size).toBeGreaterThan(100);
    const missing = [...actions].filter((a) => !labels[a.replaceAll(".", "_")]);
    expect(missing).toEqual([]);
  });
});
