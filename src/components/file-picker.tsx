"use client";

import { useState } from "react";
import { UploadIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * File input in the app's style and language (the browser's own "Choose File / No file chosen" button is
 * shown in the browser's language, not the clinic's). The real input stays in the form for submission.
 */
export function FilePicker({ id, name, accept, required, label, hint, disabled, onFile, className }: {
  id: string;
  name?: string;
  accept?: string;
  required?: boolean;
  label: string;
  hint?: string;
  disabled?: boolean;
  onFile?: (file: File | null) => void;
  className?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <div className={className}>
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={required}
        disabled={disabled}
        className="peer sr-only"
        onChange={(event) => {
          const chosen = event.target.files?.[0] ?? null;
          setFile(chosen);
          onFile?.(chosen);
        }}
      />
      <label
        htmlFor={id}
        className={cn(
          "group flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-primary/30 bg-accent/20 p-3 transition",
          "hover:border-primary/60 hover:bg-accent/40 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground transition group-hover:text-primary">
          <UploadIcon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium"><bdi>{file?.name ?? label}</bdi></span>
          {hint ? <span className="block text-xs font-normal text-muted-foreground">{hint}</span> : null}
        </span>
      </label>
    </div>
  );
}
