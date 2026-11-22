import "server-only";
import { redirect } from "next/navigation";
import { requireSession } from "./context";

export type PlatformContext = { userId: string; fullName: string; email: string };

/** Platform access never creates a tenant membership and grants no clinical-data access. */
export async function requirePlatformOperator(): Promise<PlatformContext> {
  const session = await requireSession();
  if (session.user.platformRole !== "operator") redirect("/dashboard");
  return { userId: session.userId, fullName: session.user.fullName, email: session.user.email };
}
