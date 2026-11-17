import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export async function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const t = await getTranslations("common");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const link = (target: number, disabled: boolean, children: React.ReactNode, label: string) =>
    disabled ? (
      <span aria-disabled className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>
        {children}
      </span>
    ) : (
      <Link href={hrefFor(target)} aria-label={label} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {children}
      </Link>
    );
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-2 text-sm">
      {link(page - 1, page <= 1, <ChevronLeftIcon className="rtl:rotate-180" aria-hidden />, t("previous"))}
      <span className="text-muted-foreground">{t("pageOf", { page, pages })}</span>
      {link(page + 1, page >= pages, <ChevronRightIcon className="rtl:rotate-180" aria-hidden />, t("next"))}
    </nav>
  );
}
