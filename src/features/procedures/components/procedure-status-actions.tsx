"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleSlash2Icon, TriangleAlertIcon } from "lucide-react";
import { FormError, SubmitButton, TextAreaField } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { changePerformedProcedureStatusAction } from "../actions";

type NextStatus = "reversed" | "entered_in_error";

export function ProcedureStatusActions({ procedureId }: { procedureId: string }) {
  const t = useTranslations("procedures");
  const [nextStatus, setNextStatus] = useState<NextStatus | null>(null);
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await changePerformedProcedureStatusAction(procedureId, previous, formData);
    if (result.ok) setNextStatus(null);
    return result;
  }, initialActionState);

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" variant="outline" size="sm" onClick={() => setNextStatus("reversed")}>
          <CircleSlash2Icon aria-hidden />
          {t("reverse")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setNextStatus("entered_in_error")}>
          <TriangleAlertIcon aria-hidden />
          {t("markError")}
        </Button>
      </div>

      <Dialog open={nextStatus !== null} onOpenChange={(open) => !open && setNextStatus(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {nextStatus === "reversed" ? t("reverseTitle") : t("errorTitle")}
            </DialogTitle>
            <DialogDescription>
              {nextStatus === "reversed" ? t("reverseDescription") : t("errorDescription")}
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="status" value={nextStatus ?? ""} />
            <FormError error={state.error} />
            <TextAreaField
              label={t("fields.statusReason")}
              name="reason"
              required
              rows={3}
              defaultValue={state.values?.reason ?? ""}
              error={state.fieldErrors?.reason}
            />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t("cancel")}
              </DialogClose>
              <SubmitButton variant={nextStatus === "entered_in_error" ? "destructive" : "default"}>
                {t("confirmStatus")}
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
