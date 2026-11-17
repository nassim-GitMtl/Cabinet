import type { ReactNode } from "react";

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-7 space-y-3">
      {back}
      <div className="relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-2xl border border-border/70 bg-card/85 p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,.45)] backdrop-blur sm:p-5">
        <span aria-hidden className="absolute inset-y-0 start-0 w-1 bg-gradient-to-b from-primary to-teal-300" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-balance sm:text-[1.75rem]">{title}</h1>
          {description ? <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
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
