"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { FormError, SubmitButton } from "@/components/form";
import { initialActionState } from "@/lib/action-state";
import { setJourneyAccessAction } from "@/features/consent/portal-actions";

/** Portal: the patient switches the treatment journey on (shows what the clinic shared) or off (hides it again). */
export function JourneyAccessButton({ organizationId, granted }: { organizationId: string; granted: boolean }) {
  const t = useTranslations("journey.portal");
  const [state, action] = useActionState(setJourneyAccessAction.bind(null, organizationId, granted ? "revoked" : "granted"), initialActionState);
  return (
    <form action={action} className="space-y-2">
      <FormError error={state.error} />
      <SubmitButton variant={granted ? "outline" : "default"} size={granted ? "sm" : "default"}>
        {granted ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
        {granted ? t("hide") : t("show")}
      </SubmitButton>
    </form>
  );
}
