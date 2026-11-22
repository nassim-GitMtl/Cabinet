import { z } from "zod";
import { ASSIGNABLE_PERMISSIONS } from "@/server/authz/permissions";

export const staffInvitationSchema = z.object({
  email: z.email("invalidEmail").trim().toLowerCase(),
  fullName: z.string().trim().min(2, "required").max(150),
  roleId: z.uuid("required"),
  title: z.string().trim().max(80).nullable().optional().transform((v) => v || null),
  isProvider: z.boolean().default(false),
});

export const roleSchema = z.object({
  name: z.string().trim().min(2, "required").max(100),
  /** Owner-only keys (practitioner fees) cannot be given to another role. */
  permissions: z.array(z.enum(ASSIGNABLE_PERMISSIONS)),
});

export const invitationAcceptSchema = z.object({
  password: z.string().min(1, "required").max(200),
  confirmPassword: z.string().max(200),
}).refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "passwordMismatch" });
