"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { setArchivedAction } from "../actions";

export function ArchiveButton({ patientId, archived }: { patientId: string; archived: boolean }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  if (archived) {
    return (
      <Button variant="outline" disabled={pending} onClick={() => startTransition(() => setArchivedAction(patientId, false))}>
        <ArchiveRestoreIcon aria-hidden />
        {t("patients.restore")}
      </Button>
    );
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ArchiveIcon aria-hidden />
        {t("patients.archive")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("patients.archive")}</DialogTitle>
            <DialogDescription>{t("patients.archiveConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await setArchivedAction(patientId, true);
                  setOpen(false);
                })
              }
            >
              {t("patients.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
