import type { z } from "zod";

/** Uniform result for server actions consumed with useActionState. */
export type ActionState = {
  ok?: boolean;
  /** Translation key under `errors.*` or a feature namespace. */
  error?: string;
  /** Field name -> translation key under `errors.*`. */
  fieldErrors?: Record<string, string>;
  /** Echo of submitted values so the form keeps user input after an error. */
  values?: Record<string, string>;
  /** Arbitrary payload (e.g. duplicate candidates). */
  data?: unknown;
};

export const initialActionState: ActionState = {};

export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}

export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message && /^[a-zA-Z.]+$/.test(issue.message) ? issue.message : "required";
  }
  return out;
}
