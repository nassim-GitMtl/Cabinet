import { z } from "zod";
import { SHARE_CATEGORIES } from "@/server/db/schema";

export const portalInvitationSchema = z.object({
  email: z.email("invalidEmail").trim().toLowerCase(),
  evidenceRef: z.string().trim().min(3, "required").max(200),
});

export const consentRequestSchema = z.object({
  purpose: z.string().trim().min(3, "required").max(500),
  categories: z.array(z.enum(SHARE_CATEGORIES)).min(1, "required"),
  dateFrom: z.string().trim().nullable().optional().transform((v) => v || null),
  dateTo: z.string().trim().nullable().optional().transform((v) => v || null),
  includeFutureUpdates: z.boolean().default(false),
  expiresInDays: z.coerce.number().int().min(1).max(90).default(30),
}).refine((v) => !v.dateFrom || !v.dateTo || v.dateFrom <= v.dateTo, { path: ["dateTo"], message: "invalidDateRange" });

export type ConsentRequestInput = z.infer<typeof consentRequestSchema>;

export const portalPasswordSchema = z.object({
  password: z.string().min(10, "tooShort").max(200, "tooLong"),
  confirmPassword: z.string(),
}).refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "passwordMismatch" });

export const portalLoginSchema = z.object({ email: z.email("invalidEmail").trim().toLowerCase(), password: z.string().min(1, "required") });
