"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

/** URL-driven search: debounced, keeps other params, resets pagination. */
export function SearchInput({ placeholder, label, param = "q" }: { placeholder: string; label: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get(param) ?? "");
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const push = (next: string) => {
    const sp = new URLSearchParams(params.toString());
    if (next.trim()) sp.set(param, next.trim());
    else sp.delete(param);
    sp.delete("page");
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`, { scroll: false }));
  };

  return (
    <form
      role="search"
      className="relative w-full sm:max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        push(value);
      }}
    >
      <label htmlFor="list-search" className="sr-only">
        {label}
      </label>
      <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        id="list-search"
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        className="ps-9 pe-9"
        onChange={(e) => {
          setValue(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          const next = e.target.value;
          timer.current = setTimeout(() => push(next), 300);
        }}
      />
      {pending ? (
        <Loader2Icon className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
      ) : null}
    </form>
  );
}
