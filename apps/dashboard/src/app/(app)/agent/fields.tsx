'use client';

/**
 * Form primitives for the configurator (ws-d3 §3). Each renders its label, the
 * control, and — when the live Zod validation flags this path — an inline error,
 * mapped from `validateAgentConfig`'s structured `path` + `message`.
 */
import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type FieldErrors = Map<string, string>;

function ErrorText({ errors, path }: { errors: FieldErrors; path: string }) {
  const message = errors.get(path);
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
  htmlFor?: string | undefined;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

export function TextInput({
  label,
  hint,
  value,
  onChange,
  disabled,
  errors,
  path,
  type = 'text',
}: {
  label: string;
  hint?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean | undefined;
  errors: FieldErrors;
  path: string;
  type?: 'text' | 'number';
}) {
  const invalid = errors.has(path);
  return (
    <Field label={label} hint={hint} htmlFor={path}>
      <Input
        id={path}
        type={type}
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
      />
      <ErrorText errors={errors} path={path} />
    </Field>
  );
}

export function TextAreaInput({
  label,
  hint,
  value,
  onChange,
  disabled,
  errors,
  path,
  rows = 3,
}: {
  label: string;
  hint?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean | undefined;
  errors: FieldErrors;
  path: string;
  rows?: number;
}) {
  const invalid = errors.has(path);
  return (
    <Field label={label} hint={hint} htmlFor={path}>
      <Textarea
        id={path}
        rows={rows}
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
      />
      <ErrorText errors={errors} path={path} />
    </Field>
  );
}

export function SelectInput<T extends string>({
  label,
  hint,
  value,
  onChange,
  disabled,
  options,
}: {
  label: string;
  hint?: string | undefined;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean | undefined;
  options: { value: T; label: string }[];
}) {
  return (
    <Field label={label} hint={hint}>
      <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled ?? false}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string | undefined;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <label className={cn('flex items-start gap-3', disabled && 'opacity-60')}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
