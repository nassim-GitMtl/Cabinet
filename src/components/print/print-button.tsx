"use client";

import { PrinterIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  const t = useTranslations("billing");
  return (
    <Button onClick={() => window.print()} className="no-print">
      <PrinterIcon aria-hidden />
      {t("print")}
    </Button>
  );
}
