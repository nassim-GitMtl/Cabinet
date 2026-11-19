import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBookingLink, listBookingLinks, setBookingLinkActive } from "@/features/booking/server";
import { getServicePickerData } from "@/features/catalog/server";
import { getPublicClinicPage, getPublicPageSettings, PublicPageError, savePublicProfile, type PublicProfileInput } from "@/features/public-page/server";
import { ForbiddenError } from "@/server/auth/context";
import { clinicPublicProfiles } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

async function asOwner(run: (sql: import("postgres").Sql) => Promise<unknown>) {
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.TEST_DATABASE_URL_ADMIN!, { max: 1 });
  try { await run(sql); } finally { await sql.end(); }
}

async function setup(name: string, slug: string) {
  const ctx = await makeClinic(name);
  const picker = await getServicePickerData(ctx);
  const all = picker.categories.flatMap((c) => c.services);
  const input = (extra: Partial<PublicProfileInput> = {}): PublicProfileInput => ({
    slug, isPublished: true, about: { fr: "Soins dentaires pour toute la famille.", en: "", ar: "" },
    whatsappPhone: "0661 11 22 33", mapUrl: "https://maps.app.goo.gl/abc", facebookUrl: "", instagramUrl: "",
    reviewUrl: "https://g.page/r/cabinet-demo/review",
    bookingLinkId: null, featuredServiceIds: [all[0]!.id, all[1]!.id], showPrices: true, ...extra,
  });
  return { ctx, all, input };
}

describe("clinic public page", () => {
  it("publishes a page with hours from the agenda, chosen treatments and online booking", async () => {
    const f = await setup("Cabinet Vitrine A", "cabinet-vitrine-a");
    const token = await createBookingLink(f.ctx, "Page publique");
    const linkId = (await listBookingLinks(f.ctx)).find((l) => l.token === token)!.id;
    await savePublicProfile(f.ctx, f.input({ bookingLinkId: linkId }));

    const page = (await getPublicClinicPage("Cabinet-Vitrine-A"))!;
    expect(page).toMatchObject({ name: "Cabinet Vitrine A", whatsappPhone: "+213661112233", mapUrl: "https://maps.app.goo.gl/abc", bookingToken: token });
    expect(page.about.fr).toBe("Soins dentaires pour toute la famille.");
    // New clinics are seeded with Sunday–Thursday hours; Friday stays closed.
    expect(page.hours[7]!.length).toBeGreaterThan(0);
    expect(page.hours[5]).toEqual([]);
    expect(page.services.map((s) => s.id)).toEqual([f.all[0]!.id, f.all[1]!.id]);
    expect(page.services[0]!.priceMinor).toBe(f.all[0]!.priceMinor);

    // Prices are opt-in; saving again updates the same page.
    await savePublicProfile(f.ctx, f.input({ showPrices: false, bookingLinkId: linkId }));
    expect((await getPublicClinicPage("cabinet-vitrine-a"))!.services[0]!.priceMinor).toBeNull();
    // A deactivated booking link is never shown.
    await setBookingLinkActive(f.ctx, linkId, false);
    expect((await getPublicClinicPage("cabinet-vitrine-a"))!.bookingToken).toBeNull();
    expect((await getPublicPageSettings(f.ctx)).profile).toMatchObject({ slug: "cabinet-vitrine-a", showPrices: false });
    let reviewUrl: string | undefined;
    await asOwner(async (sql) => {
      [{ review_url: reviewUrl }] = await sql`select settings->'followUps'->>'reviewUrl' as review_url from organizations where id = ${f.ctx.organizationId}`;
    });
    expect(reviewUrl).toBe("https://g.page/r/cabinet-demo/review");

    await savePublicProfile(f.ctx, f.input({ isPublished: false }));
    expect(await getPublicClinicPage("cabinet-vitrine-a")).toBeNull();
    expect(await getPublicClinicPage("n'importe quoi")).toBeNull();
  });

  it("validates the address, links and permissions, and keeps each clinic to its own data", async () => {
    const a = await setup("Cabinet Vitrine B", "cabinet-vitrine-b");
    const b = await setup("Cabinet Vitrine C", "cabinet-vitrine-c");
    await savePublicProfile(a.ctx, a.input());

    await expect(savePublicProfile(b.ctx, b.input({ slug: "cabinet-vitrine-b" }))).rejects.toMatchObject({ code: "slugTaken" });
    await expect(savePublicProfile(b.ctx, b.input({ slug: "Cabinet B!" }))).rejects.toMatchObject({ code: "slug" });
    await expect(savePublicProfile(b.ctx, b.input({ mapUrl: "http://maps.example.com" }))).rejects.toMatchObject({ code: "invalidUrl", field: "mapUrl" });
    await expect(savePublicProfile(b.ctx, b.input({ reviewUrl: "http://reviews.example.com" }))).rejects.toMatchObject({ code: "invalidUrl", field: "reviewUrl" });
    await expect(savePublicProfile(b.ctx, b.input({ whatsappPhone: "12" }))).rejects.toBeInstanceOf(PublicPageError);
    await expect(savePublicProfile(b.ctx, b.input({ featuredServiceIds: [a.all[0]!.id] }))).rejects.toMatchObject({ code: "serviceUnavailable" });
    await expect(savePublicProfile(contextFor(b.ctx, "receptionist"), b.input())).rejects.toBeInstanceOf(ForbiddenError);

    await savePublicProfile(b.ctx, b.input());
    // The database refuses another clinic's treatments even if the service layer were bypassed.
    await expectDbError(
      withDbContext({ organizationId: b.ctx.organizationId, userId: b.ctx.userId, actorType: "staff" }, (tx) =>
        tx.update(clinicPublicProfiles).set({ featuredServiceIds: [a.all[0]!.id] }).where(eq(clinicPublicProfiles.organizationId, b.ctx.organizationId))),
      /same organization/,
    );
    const pageB = (await getPublicClinicPage("cabinet-vitrine-c"))!;
    expect(pageB.name).toBe("Cabinet Vitrine C");
    expect(pageB.services.every((s) => b.all.some((x) => x.id === s.id))).toBe(true);
  });
});
