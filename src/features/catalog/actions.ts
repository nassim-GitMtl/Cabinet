"use server";

import { revalidatePath } from "next/cache";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/action-state";
import { parseMoneyInput } from "@/lib/money";
import { ForbiddenError, requireClinicContext } from "@/server/auth/context";
import { ConflictError } from "@/server/errors";
import {
  createService,
  DuplicateCodeError,
  getServiceWithHistory,
  serviceInputSchema,
  setServiceActive,
  updateService,
} from "./server";

function parse(values: Record<string, string>, currency: string) {
  const priceMinor = parseMoneyInput(values.price ?? "", currency);
  const parsed = serviceInputSchema.safeParse({ ...values, priceMinor: priceMinor ?? -1 });
  const fieldErrors = parsed.success ? {} : fieldErrorsOf(parsed.error);
  if (priceMinor === null || priceMinor < 0) {
    delete fieldErrors.priceMinor;
    fieldErrors.price = "invalidAmount";
  }
  return { parsed, fieldErrors };
}

function mapError(err: unknown, values: Record<string, string>): ActionState {
  if (err instanceof ForbiddenError) return { error: "forbidden", values };
  if (err instanceof ConflictError) return { error: "conflict", values };
  if (err instanceof DuplicateCodeError) return { fieldErrors: { code: "duplicateCode" }, values };
  throw err;
}

export async function saveServiceAction(
  serviceId: string | null,
  version: number | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireClinicContext();
  const values = formValues(formData);
  const { parsed, fieldErrors } = parse(values, ctx.organization.defaultCurrency);
  if (!parsed.success || Object.keys(fieldErrors).length) return { fieldErrors, values };
  try {
    if (serviceId && version !== null) await updateService(ctx, serviceId, parsed.data, version);
    else await createService(ctx, parsed.data);
  } catch (err) {
    return mapError(err, values);
  }
  revalidatePath("/catalog");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function setServiceActiveAction(serviceId: string, active: boolean) {
  const ctx = await requireClinicContext();
  await setServiceActive(ctx, serviceId, active);
  revalidatePath("/catalog");
}

export async function priceHistoryAction(serviceId: string) {
  const ctx = await requireClinicContext();
  const data = await getServiceWithHistory(ctx, serviceId);
  return (
    data?.history.map((h) => ({
      id: h.id,
      priceMinor: h.priceMinor,
      currency: h.currency,
      effectiveFrom: h.effectiveFrom.toISOString(),
      reason: h.reason,
    })) ?? []
  );
}
