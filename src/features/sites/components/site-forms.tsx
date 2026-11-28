"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PencilIcon, PlusIcon } from "lucide-react";
import { FormError, SubmitButton, TextField } from "@/components/form";
import { ActionButton, DialogButton } from "@/features/billing/components/billing-dialogs";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { saveSiteAction, setSiteActiveAction } from "../actions";

type Site = { id: string; name: string; address: string | null; phone: string | null; email: string | null };

function useForm(fn: (p: ActionState, fd: FormData) => Promise<ActionState>, onOk?: () => void) {
  const router = useRouter();
  return useActionState(async (p: ActionState, fd: FormData) => {
    const r = await fn(p, fd);
    if (r.ok) {
      onOk?.();
      router.refresh();
    }
    return r;
  }, initialActionState);
}

export function SiteButton({ site }: { site?: Site & { phoneDisplay: string } }) {
  const t = useTranslations("sites");
  return (
    <DialogButton
      label={site ? t("edit") : t("add")}
      title={site ? t("edit") : t("add")}
      description={site ? undefined : t("addHint")}
      variant={site ? "ghost" : "default"}
      icon={site ? <PencilIcon aria-hidden /> : <PlusIcon aria-hidden />}
    >
      {(close) => <SiteForm site={site} close={close} />}
    </DialogButton>
  );
}

function SiteForm({ site, close }: { site?: Site & { phoneDisplay: string }; close: () => void }) {
  const t = useTranslations("sites");
  const [state, action] = useForm(saveSiteAction.bind(null, site?.id ?? null), close);
  const v = state.values;
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <TextField label={t("name")} name="name" required maxLength={120} defaultValue={v?.name ?? site?.name} error={state.fieldErrors?.name} />
      <TextField label={t("address")} name="address" optionalLabel defaultValue={v?.address ?? site?.address ?? ""} />
      <TextField label={t("phone")} name="phone" type="tel" dir="ltr" optionalLabel hint={t("phoneHint")} defaultValue={v?.phone ?? site?.phoneDisplay ?? ""} />
      <TextField label={t("email")} name="email" type="email" dir="ltr" optionalLabel defaultValue={v?.email ?? site?.email ?? ""} />
      <SubmitButton className="w-full">{site ? t("save") : t("add")}</SubmitButton>
    </form>
  );
}

export function SiteActiveButton({ siteId, active }: { siteId: string; active: boolean }) {
  const t = useTranslations("sites");
  return <ActionButton run={() => setSiteActiveAction(siteId, !active)} label={active ? t("close") : t("reopen")} variant={active ? "ghost" : "outline"} />;
}
