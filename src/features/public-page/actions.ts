"use server";

import { revalidatePath } from "next/cache";
import { formValues, type ActionState } from "@/lib/action-state";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { PublicPageError, savePublicProfile } from "./server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function savePublicProfileAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  // Checkbox lists send one entry per ticked service; keep them for re-display after an error.
  const featured = formData.getAll("featuredServiceIds").filter((v): v is string => typeof v === "string" && UUID.test(v));
  const about = { fr: values["about.fr"] ?? "", en: values["about.en"] ?? "", ar: values["about.ar"] ?? "" };
  if (Object.values(about).some((text) => text.length > 600)) return { fieldErrors: { about: "tooLong" }, values, data: { featured } };
  try {
    await savePublicProfile(ctx, {
      slug: values.slug ?? "",
      isPublished: values.isPublished === "on",
      about,
      whatsappPhone: values.whatsappPhone ?? "",
      mapUrl: values.mapUrl ?? "",
      facebookUrl: values.facebookUrl ?? "",
      instagramUrl: values.instagramUrl ?? "",
      bookingLinkId: values.bookingLinkId && UUID.test(values.bookingLinkId) ? values.bookingLinkId : null,
      featuredServiceIds: featured,
      showPrices: values.showPrices === "on",
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: "forbidden", values, data: { featured } };
    if (error instanceof PublicPageError) {
      return { error: "fixErrors", fieldErrors: error.field ? { [error.field]: `publicPage.errors.${error.code}` } : undefined, values, data: { featured } };
    }
    throw error;
  }
  revalidatePath("/settings/public-page");
  revalidatePath(`/c/${(values.slug ?? "").trim().toLowerCase()}`);
  return { ok: true, values, data: { featured } };
}
