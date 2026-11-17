"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, CopyIcon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createStaffInvitationAction, updateMembershipAction } from "@/features/access/actions";
import { initialActionState } from "@/lib/action-state";

type Role = { id: string; key: string; name: string };
type Staff = { id: string; userId: string; displayName: string; email: string; title: string | null; isProvider: boolean; status: string; roleId: string; roleKey: string; roleName: string };
type Invitation = { id: string; email: string; fullName: string; roleName: string; roleKey: string; expiresAt: Date; acceptedAt: Date | null };

export function TeamManagement({ roles, staff, invitations, currentUserId }: { roles: Role[]; staff: Staff[]; invitations: Invitation[]; currentUserId: string }) {
  const t = useTranslations("access"); const all = useTranslations(); const [state, action] = useActionState(createStaffInvitationAction, initialActionState); const [copied, setCopied] = useState(false);
  const invite = state.data as { path: string } | undefined;
  const roleLabel = (role: Role) => all.has(`roles.${role.key}` as never) ? all(`roles.${role.key}` as never) : role.name;
  const options = roles.map((role) => ({ value: role.id, label: roleLabel(role) }));
  return <div className="grid gap-6 xl:grid-cols-[24rem_1fr]">
    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">{t("inviteTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("inviteHint")}</p>
      <form action={action} className="mt-4 space-y-3" noValidate><FormError error={state.error} />
        <TextField label={t("fullName")} name="fullName" required defaultValue={state.values?.fullName} error={state.fieldErrors?.fullName} />
        <TextField label={t("email")} name="email" type="email" required defaultValue={state.values?.email} error={state.fieldErrors?.email} />
        <SelectField label={t("role")} name="roleId" options={options} required defaultValue={state.values?.roleId} error={state.fieldErrors?.roleId} />
        <TextField label={t("titleField")} name="title" optionalLabel defaultValue={state.values?.title} />
        <label className="flex items-center gap-2 text-sm"><Checkbox name="isProvider" />{t("isProvider")}</label>
        <SubmitButton className="w-full">{t("createInvitation")}</SubmitButton>
      </form>
      {invite ? <div className="mt-4 rounded-lg bg-primary/5 p-3 text-xs"><p className="font-medium">{t("invitationLink")}</p><code className="mt-1 block break-all" dir="ltr">{invite.path}</code><Button type="button" size="sm" variant="outline" className="mt-2" onClick={async () => { await navigator.clipboard.writeText(`${location.origin}${invite.path}`); setCopied(true); }}>{copied ? <CheckIcon /> : <CopyIcon />}{copied ? t("copied") : t("copy")}</Button></div> : null}
    </section>
    <div className="space-y-6"><section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">{t("team")}</h2><div className="mt-3 divide-y">
      {staff.map((member) => <MemberRow key={member.id} member={member} roles={roles} protectedMember={member.roleKey === "owner" || member.userId === currentUserId} />)}
    </div></section>
    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">{t("invitations")}</h2><ul className="mt-3 divide-y">{invitations.map((inviteRow) => <li key={inviteRow.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div><bdi className="font-medium">{inviteRow.fullName}</bdi><p className="text-xs text-muted-foreground"><bdi>{inviteRow.email}</bdi> · {all.has(`roles.${inviteRow.roleKey}` as never) ? all(`roles.${inviteRow.roleKey}` as never) : inviteRow.roleName}</p></div><Badge variant="outline">{inviteRow.acceptedAt ? t("accepted") : inviteRow.expiresAt > new Date() ? t("pending") : t("expired")}</Badge></li>)}</ul></section></div>
  </div>;
}

function MemberRow({ member, roles, protectedMember }: { member: Staff; roles: Role[]; protectedMember: boolean }) {
  const t = useTranslations("access"); const all = useTranslations(); const [state, action] = useActionState(updateMembershipAction.bind(null, member.id), initialActionState);
  return <div className="py-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium"><bdi>{[member.title, member.displayName].filter(Boolean).join(" ")}</bdi></p><p className="text-xs text-muted-foreground"><bdi>{member.email}</bdi></p></div><div className="flex gap-2">{member.isProvider ? <Badge variant="secondary">{t("provider")}</Badge> : null}<Badge variant="outline">{t(`status.${member.status}`)}</Badge></div></div>
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2"><FormError error={state.error} /><SelectField label={t("role")} name="roleId" options={roles.map((r) => ({ value: r.id, label: all.has(`roles.${r.key}` as never) ? all(`roles.${r.key}` as never) : r.name }))} defaultValue={member.roleId} required fieldClassName="min-w-48 flex-1" /><SelectField label={t("statusLabel")} name="status" options={[{ value: "active", label: t("status.active") }, { value: "deactivated", label: t("status.deactivated") }]} defaultValue={member.status === "deactivated" ? "deactivated" : "active"} fieldClassName="min-w-40" /><SubmitButton variant="outline" disabled={protectedMember}>{t("save")}</SubmitButton></form>
  </div>;
}
