"use client";

import { useId, type ChangeEventHandler, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Resolves an error key: "auth.invalid" (namespaced) or "required" (under errors.*). */
export function useErrorText() {
  const t = useTranslations();
  return (key?: string | null) => {
    if (!key) return undefined;
    const full = key.includes(".") ? key : `errors.${key}`;
    return t.has(full as never) ? t(full as never) : t("errors.generic");
  };
}

type FieldShellProps = {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  optionalLabel?: boolean;
  hideLabel?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
};

function FieldShell({ label, error, hint, required, optionalLabel, hideLabel, className, children }: FieldShellProps) {
  const id = useId();
  const t = useTranslations("common");
  const errorText = useErrorText()(error);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errorText ? `${id}-error` : undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id} className={cn("text-sm font-medium", hideLabel && "sr-only")}>
        {label}
        {required ? <span aria-hidden className="text-destructive"> *</span> : null}
        {optionalLabel ? <span className="font-normal text-muted-foreground"> ({t("optional")})</span> : null}
      </Label>
      {children({ id, describedBy: [hintId, errorId].filter(Boolean).join(" ") || undefined, invalid: !!errorText })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {errorText ? (
        <p id={errorId} className="flex items-center gap-1 text-xs font-medium text-destructive">
          <AlertCircleIcon className="size-3.5" aria-hidden />
          {errorText}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = Omit<ComponentProps<typeof Input>, "id"> & {
  label: ReactNode;
  name: string;
  error?: string;
  hint?: ReactNode;
  optionalLabel?: boolean;
  hideLabel?: boolean;
  fieldClassName?: string;
};

export function TextField({ label, error, hint, required, optionalLabel, hideLabel, fieldClassName, ...props }: TextFieldProps) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} optionalLabel={optionalLabel} hideLabel={hideLabel} className={fieldClassName}>
      {({ id, describedBy, invalid }) => (
        <Input id={id} required={required} aria-invalid={invalid || undefined} aria-describedby={describedBy} {...props} />
      )}
    </FieldShell>
  );
}

type TextAreaFieldProps = Omit<ComponentProps<typeof Textarea>, "id"> & {
  label: ReactNode;
  name: string;
  error?: string;
  hint?: ReactNode;
  optionalLabel?: boolean;
  fieldClassName?: string;
};

export function TextAreaField({ label, error, hint, required, optionalLabel, fieldClassName, ...props }: TextAreaFieldProps) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} optionalLabel={optionalLabel} className={fieldClassName}>
      {({ id, describedBy, invalid }) => (
        <Textarea id={id} required={required} aria-invalid={invalid || undefined} aria-describedby={describedBy} {...props} />
      )}
    </FieldShell>
  );
}

type SelectFieldProps = {
  label: ReactNode;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  value?: string;
  onChange?: ChangeEventHandler<HTMLSelectElement>;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  optionalLabel?: boolean;
  hideLabel?: boolean;
  placeholder?: string;
  fieldClassName?: string;
};

/** Native select: best touch UX on iOS/Android and works with FormData. */
export function SelectField({ label, name, options, defaultValue, value, onChange, error, hint, required, optionalLabel, hideLabel, placeholder, fieldClassName }: SelectFieldProps) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} optionalLabel={optionalLabel} hideLabel={hideLabel} className={fieldClassName}>
      {({ id, describedBy, invalid }) => (
        <NativeSelect
          id={id}
          name={name}
          defaultValue={value === undefined ? defaultValue ?? "" : undefined}
          value={value}
          onChange={onChange}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="w-full"
        >
          {placeholder !== undefined ? <NativeSelectOption value="">{placeholder}</NativeSelectOption> : null}
          {options.map((o) => (
            <NativeSelectOption key={o.value} value={o.value}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FieldShell>
  );
}

export function FormError({ error }: { error?: string }) {
  const text = useErrorText()(error);
  if (!text) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircleIcon />
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}

export function SubmitButton({ children, className, ...props }: ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();
  const t = useTranslations("common");
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} className={className} {...props}>
      {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
      {pending ? t("saving") : children}
    </Button>
  );
}
