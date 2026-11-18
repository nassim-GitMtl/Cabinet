import postgres from "postgres";
import { describe, expect, it } from "vitest";

/**
 * Regression guard: tables whose rows must never be deleted by the app role,
 * and append-only ledgers that must never be updated. Checked directly in the
 * catalog so a future migration re-running apply_security() cannot reopen them.
 */
const NO_DELETE = ["payments", "cash_sessions", "expenses", "appointments", "booking_requests", "treatment_plans", "clinical_notes", "questionnaire_versions", "inventory_items", "inventory_purchase_orders", "inventory_item_identifiers", "procedure_consumptions"];
const APPEND_ONLY = ["service_prices", "credit_notes", "payment_allocations", "refunds", "cash_movements", "clinical_note_versions", "questionnaire_responses", "health_history_reviews", "odontogram_findings", "inventory_lots", "inventory_movements", "inventory_purchase_order_lines", "audit_events"];

describe("database privileges of the runtime role", () => {
  it("cannot delete protected rows or modify append-only ledgers", async () => {
    const sql = postgres(process.env.TEST_DATABASE_URL_ADMIN!, { max: 1 });
    try {
      const rows = await sql<{ table_name: string; privilege_type: string }[]>`
        select table_name, privilege_type from information_schema.role_table_grants
         where grantee = 'cabinet_app' and table_schema = 'public'`;
      const has = (t: string, p: string) => rows.some((r) => r.table_name === t && r.privilege_type === p);
      for (const t of NO_DELETE) expect(has(t, "DELETE"), `${t} DELETE`).toBe(false);
      for (const t of APPEND_ONLY) {
        expect(has(t, "UPDATE"), `${t} UPDATE`).toBe(false);
        expect(has(t, "DELETE"), `${t} DELETE`).toBe(false);
        expect(has(t, "INSERT"), `${t} INSERT`).toBe(true);
      }
    } finally {
      await sql.end();
    }
  });
});
