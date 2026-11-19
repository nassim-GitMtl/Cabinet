import type { ReactNode } from "react";
import type { IssuerSnapshot } from "@/server/db/schema";
import { formatPhone } from "@/lib/phone";

/**
 * Header of printed documents. `issuer` is the copy frozen on an issued document (or the live details
 * for drafts and estimates), so reprinting an old invoice never shows newer legal details.
 */
export function DocumentHeader({
  clinicName,
  issuer,
  logoVersion,
  title,
  subtitle,
}: {
  clinicName: string;
  issuer: IssuerSnapshot | null;
  /** Current logo version (cache key); the logo is decoration, not a legal mention, so it is not frozen. */
  logoVersion?: string | null;
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  const name = issuer?.clinicName || clinicName;
  const identifiers = Object.entries(issuer?.identifiers ?? {}).filter(([, v]) => v);
  const contact = [issuer?.phone ? formatPhone(issuer.phone) : null, issuer?.email].filter(Boolean).join(" · ");
  return (
    <header className="mb-5 flex items-start justify-between gap-6 border-b-2 border-[#0f7f86] pb-3">
      <div className="flex items-start gap-3">
        {logoVersion ? (
          // eslint-disable-next-line @next/next/no-img-element -- private, uncached route; next/image adds nothing for print
          <img src={`/api/clinic/logo?v=${logoVersion}`} alt="" className="max-h-16 max-w-32 object-contain" />
        ) : null}
        <div>
          <p className="text-lg font-bold text-[#0f7f86]">
            <bdi>{name}</bdi>
          </p>
          {issuer?.legalName && issuer.legalName !== name ? <p><bdi>{issuer.legalName}</bdi></p> : null}
          {issuer?.address ? <p className="whitespace-pre-line"><bdi>{issuer.address}</bdi></p> : null}
          {contact ? <p dir="ltr" className="text-start">{contact}</p> : null}
          {identifiers.length ? (
            <p className="text-[11px] text-neutral-600" dir="ltr">
              {identifiers.map(([k, v]) => `${k}: ${v}`).join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
      <div className="text-end">
        <p className="text-xl font-bold uppercase tracking-wide">{title}</p>
        {subtitle}
      </div>
    </header>
  );
}
