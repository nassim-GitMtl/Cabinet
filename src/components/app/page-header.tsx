import type { ReactNode } from "react";

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-8 space-y-3">
      {back}
      <div className="relative flex flex-wrap items-center justify-between gap-5 overflow-hidden rounded-2xl border border-border/75 bg-card/88 p-5 shadow-[0_16px_34px_-30px_rgba(48,39,25,.38)] sm:p-6">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-[-0.035em] text-balance sm:text-[1.9rem]">{title}</h1>
          {description ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 sm:ms-auto">{actions}</div> : null}
      </div>
    </div>
  );
}

export function ForbiddenState({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-2xl border border-dashed bg-card/85 p-8 text-center text-sm text-muted-foreground shadow-sm">
      {message}
    </div>
  );
}
