"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { LOCALE_REGISTRY, type Locale, SELECTABLE_LOCALES } from "@/features/i18n/registry";
import type { ManagementUiProps } from "./types";
export function InvitationForm({
  L,
  pending,
  send,
  viewerIsAdmin,
}: ManagementUiProps & { viewerIsAdmin: boolean }) {
  const id = useId();
  const currentLocale = useLocale();
  const [locale, setLocale] = useState<Locale>(currentLocale);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isAdmin, setAdmin] = useState(false);
  return (
    <form
      className="space-y-5 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        void send({ action: "invite", name, email, isAdmin, locale }).then((success) => {
          if (success) {
            setName("");
            setEmail("");
            setAdmin(false);
          }
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor={`${id}-name`} className="space-y-1 text-sm">
          <span>{L.name}</span>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={120}
            autoComplete="name"
          />
        </label>
        <label htmlFor={`${id}-email`} className="space-y-1 text-sm">
          <span>{L.email}</span>
          <Input
            id={`${id}-email`}
            type="email"
            dir="ltr"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            maxLength={254}
            autoComplete="email"
          />
        </label>
      </div>
      <div className="space-y-4">
        <div className="min-w-40">
          <Select
            ariaLabel={L.language}
            value={locale}
            onChange={(value) => setLocale(value as Locale)}
            options={SELECTABLE_LOCALES.map((value) => ({
              value,
              label: LOCALE_REGISTRY[value].name,
            }))}
          />
        </div>
        {viewerIsAdmin && (
          <label htmlFor={`${id}-admin`} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${id}-admin`}
              checked={isAdmin}
              onCheckedChange={setAdmin}
              label={L.adminRole}
              disabled={pending}
            />
            <span>{L.adminRole}</span>
          </label>
        )}
        <div className="flex justify-end border-t pt-4">
          <Button type="submit" disabled={pending}>
            {pending ? L.sending : L.invite}
          </Button>
        </div>
      </div>
    </form>
  );
}
