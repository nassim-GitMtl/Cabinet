import type { ReactNode } from "react";

export function DocumentHeader({
  clinicName,
  legalName,
  address,
  identifiers,
  title,
  subtitle,
}: {
  clinicName: string;
  legalName?: string | null;
  address?: string | null;
  identifiers?: Record<string, string>;
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <header className="mb-5 flex items-start justify-between gap-6 border-b-2 border-[#0f7f86] pb-3">
      <div>
        <p className="text-lg font-bold text-[#0f7f86]">
          <bdi>{clinicName}</bdi>
        </p>
        {legalName && legalName !== clinicName ? <p><bdi>{legalName}</bdi></p> : null}
        {address ? <p className="whitespace-pre-line">{address}</p> : null}
        {identifiers && Object.keys(identifiers).length ? (
          <p className="text-[11px] text-neutral-600">
            {Object.entries(identifiers)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")}
          </p>
        ) : null}
      </div>
      <div className="text-end">
        <p className="text-xl font-bold uppercase tracking-wide">{title}</p>
        {subtitle}
      </div>
    </header>
  );
}
