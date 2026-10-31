"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { useLocale, useNumberingSystem } from "@/features/i18n/LocaleProvider";
import { localeWithNumberingSystem } from "@/lib/numberingSystem";
import { normalizeDigits } from "@/utils/normalizeNumberInput";
import type { AuthPolicy } from "../domain";
import type { ManagementUiProps } from "./types";
export function PolicyForm({
  L,
  pending,
  send,
  policy,
}: ManagementUiProps & { policy: AuthPolicy }) {
  const id = useId();
  const locale = useLocale();
  const numberingSystem = useNumberingSystem();
  const formatter = new Intl.NumberFormat(localeWithNumberingSystem(locale, numberingSystem), {
    useGrouping: false,
  });
  const [mfa, setMfa] = useState(policy.requireMfaForAll);
  const [idle, setIdle] = useState(() => formatter.format(policy.idleMinutes));
  const [absolute, setAbsolute] = useState(() => formatter.format(policy.absoluteHours));
  const [fresh, setFresh] = useState(() => formatter.format(policy.freshMinutes));
  return (
    <form
      className="space-y-5 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        void send({
          action: "updatePolicy",
          policy: {
            requireMfaForAll: mfa,
            idleMinutes: Number(normalizeDigits(idle)),
            absoluteHours: Number(normalizeDigits(absolute)),
            freshMinutes: Number(normalizeDigits(fresh)),
          },
        });
      }}
    >
      <label htmlFor={`${id}-mfa`} className="flex items-center gap-2 text-sm">
        <Checkbox id={`${id}-mfa`} checked={mfa} onCheckedChange={setMfa} label={L.requireMfaAll} />
        <span>{L.requireMfaAll}</span>
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { suffix: "idle", label: L.idleMinutes, value: idle, change: setIdle },
          { suffix: "absolute", label: L.absoluteHours, value: absolute, change: setAbsolute },
          { suffix: "fresh", label: L.freshMinutes, value: fresh, change: setFresh },
        ].map((field) => (
          <label key={field.suffix} htmlFor={`${id}-${field.suffix}`} className="space-y-1 text-sm">
            <span>{field.label}</span>
            <Input
              id={`${id}-${field.suffix}`}
              inputMode="numeric"
              value={field.value}
              onChange={(event) => field.change(event.target.value)}
              required
            />
          </label>
        ))}
      </div>
      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? L.sending : L.savePolicy}
        </Button>
      </div>
    </form>
  );
}
