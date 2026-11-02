"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { updateCompanyGeneralAction } from "@/features/settings/actions";
import { readCsrfToken } from "@/utils/csrfCookie";
import { SettingsCard, SettingsCardBody, SettingsCardFooter } from "../SettingsSurface";

interface Props {
  companyName: string;
  baseCurrency: string;
}

// General tab (spec 6.1): editable company name + read-only base currency for existing company-level monetary data.
export function CompanyGeneralClient(props: Props): React.ReactNode {
  const L = useSettingsMessages();

  const router = useRouter();
  const [companyName, setCompanyName] = useState(props.companyName);
  const [savedName, setSavedName] = useState(props.companyName);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save(): Promise<void> {
    const submittedName = companyName.trim();
    if (pending || submittedName === savedName) return;
    setPending(true);
    setSaved(false);
    setFailed(false);
    try {
      const r = await updateCompanyGeneralAction({ companyName: submittedName }, readCsrfToken());
      if (r.ok) {
        setSavedName(submittedName);
        setSaved(true);
        router.refresh();
      } else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsCard>
      <SettingsCardBody className="grid gap-5 sm:grid-cols-2">
        <label htmlFor="company-name" className="block">
          <span className="mb-1.5 block text-sm font-medium">{L.companyName}</span>
          <Input
            id="company-name"
            aria-label={L.companyName}
            value={companyName}
            maxLength={200}
            aria-invalid={failed}
            aria-describedby={failed ? "company-name-error" : undefined}
            onChange={(e) => {
              setCompanyName(e.target.value);
              setSaved(false);
              setFailed(false);
            }}
          />
          {failed && (
            <p id="company-name-error" role="alert" className="mt-2 text-sm text-destructive">
              {L._errors.generic}
            </p>
          )}
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-medium">{L.baseCurrency}</span>
          <div className="flex min-h-9 items-center rounded-md bg-muted/50 px-3 text-sm text-muted-foreground">
            <bdi dir="ltr">{props.baseCurrency}</bdi>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {L._hierarchy.baseCurrencyDescription}
          </p>
        </div>
      </SettingsCardBody>

      <SettingsCardFooter>
        {saved && companyName.trim() === savedName ? (
          <span role="status" className="me-auto text-sm text-muted-foreground">
            {L.saved}
          </span>
        ) : null}
        <Button
          type="button"
          variant="default"
          size="sm"
          className="px-3"
          disabled={pending || companyName.trim() === savedName}
          onClick={() => void save()}
        >
          {pending ? L._extra.saving : L.save}
        </Button>
      </SettingsCardFooter>
    </SettingsCard>
  );
}
