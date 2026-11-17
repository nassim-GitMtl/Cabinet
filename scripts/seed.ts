// Demo data: a FICTITIOUS clinic with fictitious patients and edge cases.
// Run with: npm run db:seed   (idempotent: skips if the demo owner exists)
// Never run against a production database.
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { memberships, roles, users } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { hashPassword } from "@/server/auth/password";
import { registerClinic } from "@/server/services/onboarding";
import { addPatientAlert, createPatient } from "@/features/patients/server";
import type { PatientInput } from "@/features/patients/schemas";
import { contextFromIds } from "./seed-context";

const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL ?? "demo.owner@cabinet.test";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo-cabinet-2026";

const blank: Omit<PatientInput, "firstName" | "lastName"> = {
  firstNameAr: null,
  lastNameAr: null,
  sex: undefined,
  birthDate: null,
  birthDatePrecision: "exact",
  phone: null,
  phoneAlt: null,
  email: null,
  addressLine: null,
  city: null,
  region: null,
  preferredLocale: "fr",
  emergencyName: null,
  emergencyRelationship: null,
  emergencyPhone: null,
  referralSource: null,
  referredBy: null,
  administrativeNotes: null,
  assignedProviderId: null,
};

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  const existing = await db.execute(sql`select 1 from users where lower(email) = lower(${DEMO_EMAIL})`);
  if (existing.length) {
    console.log(`Demo data already present (${DEMO_EMAIL}).`);
    return;
  }

  const { userId, organizationId } = await registerClinic({
    clinicName: "Cabinet Démo Les Oliviers (fictif)",
    kind: "group",
    ownerFullName: "Samira Haddad",
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    ownerIsDentist: true,
    locale: "fr",
  });
  const ctx = await contextFromIds(userId, organizationId);

  // Extra staff: a receptionist and an accountant (same demo password).
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await withDbContext({ organizationId, userId, actorType: "staff" }, async (tx) => {
    const roleRows = await tx.select({ id: roles.id, key: roles.key }).from(roles);
    const roleId = (key: string) => roleRows.find((r) => r.key === key)!.id;
    for (const [email, name, key] of [
      ["demo.reception@cabinet.test", "Karim Meziane", "receptionist"],
      ["demo.compta@cabinet.test", "Nadia Ferhat", "accountant"],
    ] as const) {
      const [u] = await tx.insert(users).values({ email, fullName: name, passwordHash }).returning({ id: users.id });
      await tx.insert(memberships).values({ organizationId, userId: u!.id, roleId: roleId(key), displayName: name });
    }
  });

  const patients: Array<Partial<PatientInput> & { firstName: string; lastName: string }> = [
    { firstName: "Yacine", lastName: "Benali", firstNameAr: "ياسين", lastNameAr: "بن علي", birthDate: "1988-03-14", phone: "0550 12 34 56", city: "Alger", sex: "male" },
    { firstName: "Lina", lastName: "Benali", birthDate: "2016-09-02", phone: "0550 12 34 56", city: "Alger", sex: "female", emergencyName: "Yacine Benali", emergencyRelationship: "Père", emergencyPhone: "0550 12 34 56", administrativeNotes: "Téléphone partagé avec le père (dossier séparé)." },
    { firstName: "Fatima Zohra", lastName: "Belkacem", firstNameAr: "فاطمة الزهراء", lastNameAr: "بلقاسم", birthDate: "1957-01-01", birthDatePrecision: "year", phone: "0661 98 76 54", preferredLocale: "ar", sex: "female" },
    { firstName: "Hélène", lastName: "Öztürk", birthDate: "1979-11-30", email: "helene.ozturk@example.test", phone: "+33 6 12 34 56 78", preferredLocale: "fr", sex: "female" },
    { firstName: "Mohamed", lastName: "Saïdi", birthDate: "1965-06-20", phone: "0770 11 22 33", city: "Oran", referralSource: "Bouche-à-oreille" },
    { firstName: "Amine", lastName: "Kaci", birthDate: "1995-12-05", phone: "0699 45 67 89", city: "Tizi Ouzou", sex: "male" },
    { firstName: "Sara", lastName: "Mansouri", birthDate: "2001-07-18", sex: "female" },
    { firstName: "Rachid", lastName: "Boudiaf", birthDate: "1950-01-01", birthDatePrecision: "estimated", phoneAlt: "021 23 45 67", sex: "male", administrativeNotes: "Pas de téléphone portable : appeler le fixe." },
    { firstName: "Nour", lastName: "Hamdi", firstNameAr: "نور", lastNameAr: "حمدي", birthDate: "2012-04-25", phone: "0555 00 11 22", preferredLocale: "ar" },
    { firstName: "John", lastName: "Carter", birthDate: "1983-02-11", phone: "+44 7700 900123", preferredLocale: "en", email: "j.carter@example.test" },
  ];

  const created: string[] = [];
  for (const p of patients) {
    const r = await createPatient(ctx, { ...blank, ...p }, { confirmNotDuplicate: true });
    if (r.status === "created") created.push(r.id);
  }
  await addPatientAlert(ctx, created[0]!, { kind: "allergy", severity: "critical", label: "Allergie à la pénicilline (déclarée par le patient)", details: null });
  await addPatientAlert(ctx, created[4]!, { kind: "medication", severity: "warning", label: "Sous anticoagulant (à confirmer par le praticien)", details: null });

  console.log(`Seeded fictitious demo clinic "${ctx.organization.name}" with ${created.length} patients.`);
  console.log(`Sign in with ${DEMO_EMAIL} (password: SEED_DEMO_PASSWORD or the default in scripts/seed.ts).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
