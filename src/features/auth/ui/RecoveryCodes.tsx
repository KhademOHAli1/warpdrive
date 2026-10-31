"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";

export function RecoveryCodes({ codes, onContinue }: { codes: string[]; onContinue: () => void }) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const id = useId();
  const [saved, setSaved] = useState(false);
  return (
    <section className="space-y-4" aria-label={L.recoveryCodes}>
      <h2 className="font-semibold">{L.recoveryCodes}</h2>
      <p className="text-sm text-muted-foreground">{L.codesDescription}</p>
      <ul
        dir="ltr"
        className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <label htmlFor={id} className="flex items-start gap-2 text-sm">
        <Checkbox id={id} label={L.codesSaved} checked={saved} onCheckedChange={setSaved} />
        <span>{L.codesSaved}</span>
      </label>
      <Button disabled={!saved} onClick={onContinue}>
        {L.continue}
      </Button>
    </section>
  );
}
