"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormError, SubmitButton, TextField } from "@/components/form";
import { Checkbox } from "@/components/ui/checkbox";
import { createRoleAction, updateRoleAction } from "@/features/access/actions";
import { initialActionState } from "@/lib/action-state";
import { PERMISSIONS } from "@/server/authz/permissions";

type Role = { id: string; key: string; name: string; permissions: string[]; isSystem: boolean };
export function RoleEditor({ roles }: { roles: Role[] }) {
  const t = useTranslations("access"); const all = useTranslations();
  return <div className="grid gap-4 lg:grid-cols-2"><RoleForm title={t("newRole")} action={createRoleAction} />{roles.map((role) => <RoleForm key={role.id} title={all.has(`roles.${role.key}` as never) ? all(`roles.${role.key}` as never) : role.name} role={role} action={updateRoleAction.bind(null, role.id)} />)}</div>;
}
function RoleForm({ title, role, action }: { title: string; role?: Role; action: (state: typeof initialActionState, formData: FormData) => Promise<typeof initialActionState> }) {
  const t = useTranslations("access"); const [state, formAction] = useActionState(action, initialActionState); const locked = role?.key === "owner";
  return <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold"><bdi>{title}</bdi></h2><form action={formAction} className="mt-4 space-y-4"><FormError error={state.error} /><TextField label={t("roleName")} name="name" required defaultValue={role?.name ?? state.values?.name} disabled={locked} />
    <fieldset disabled={locked}><legend className="mb-2 text-sm font-medium">{t("permissions")}</legend><div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">{PERMISSIONS.map((permission) => <label key={permission} className="flex items-start gap-2 text-xs"><Checkbox name="permissions" value={permission} defaultChecked={role?.permissions.includes(permission)} /><code dir="ltr">{permission}</code></label>)}</div></fieldset>
    {locked ? <p className="text-xs text-muted-foreground">{t("ownerLocked")}</p> : <SubmitButton>{t("saveRole")}</SubmitButton>} {state.ok ? <span className="text-xs text-success">{t("saved")}</span> : null}
  </form></section>;
}
