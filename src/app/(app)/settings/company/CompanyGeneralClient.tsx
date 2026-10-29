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
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(): Promise<void> {
    setPending(true);
    setSaved(false);
    const r = await updateCompanyGeneralAction({ companyName }, readCsrfToken());
    setPending(false);
    if (r.ok) {
      setSaved(true);
      router.refresh();
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
            onChange={(e) => {
              setCompanyName(e.target.value);
              setSaved(false);
            }}
          />
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-medium">{L.baseCurrency}</span>
          <div className="flex min-h-9 items-center rounded-md bg-muted/50 px-3 text-sm text-muted-foreground">
            {props.baseCurrency}
          </div>
        </div>
      </SettingsCardBody>

      <SettingsCardFooter>
        {saved ? <span className="mr-auto text-sm text-muted-foreground">{L.saved}</span> : null}
        <Button
          type="button"
          variant="default"
          size="sm"
          className="px-3"
          disabled={pending}
          onClick={() => void save()}
        >
          {L.save}
        </Button>
      </SettingsCardFooter>
    </SettingsCard>
  );
}
