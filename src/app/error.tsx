"use client";

import { ErrorState } from "@/components/app/error-state";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-accent/60 to-background p-6">
      <ErrorState digest={error.digest} reset={reset} homeHref="/" />
    </main>
  );
}
