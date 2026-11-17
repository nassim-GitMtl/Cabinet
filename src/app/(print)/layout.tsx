import { requireClinicContext } from "@/server/auth/context";
import "./print.css";

/** Minimal A4 document layout (no app chrome). Authorization is still enforced per page. */
export default async function PrintLayout({ children }: LayoutProps<"/">) {
  await requireClinicContext();
  return <div className="print-root mx-auto max-w-[210mm] bg-white p-6 text-[13px] text-black print:p-0">{children}</div>;
}
