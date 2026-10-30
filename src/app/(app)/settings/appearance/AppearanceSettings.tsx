"use client";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { Button } from "@/components/ui/Button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { setDensityAction } from "@/features/identity/preferencesActions";
import type { Density } from "@/features/identity/preferencesSchema";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import type { Appearance } from "@/features/theme/appearance";
import { useAppearanceChoice } from "@/features/theme/useAppearanceChoice";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardFooter,
  SettingsCardHeader,
} from "../SettingsSurface";

export function AppearanceSettings({
  density: storedDensity,
  appearance,
}: {
  density: Density;
  appearance: Appearance;
}) {
  const L = useSettingsMessages();
  const H = L._hierarchy;
  const t = useAppTranslations("shell.appearance");
  const choice = useAppearanceChoice(appearance);
  const router = useRouter();
  const reportError = useActionError();
  const id = useId();
  const [density, setDensity] = useState(storedDensity);
  const [savedDensity, setSavedDensity] = useState(storedDensity);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(): Promise<void> {
    setPending(true);
    setSaved(false);
    try {
      const result = await setDensityAction({ density }, readCsrfToken());
      if (result.ok) {
        setSavedDensity(density);
        setSaved(true);
        router.refresh();
      } else reportError(result.error.id);
    } catch {
      reportError();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <SettingsCard>
        <SettingsCardHeader title={H.theme} description={H.themeDescription} />
        <SettingsCardBody className="space-y-3">
          <Select
            ariaLabel={H.theme}
            value={choice.value}
            onChange={choice.choose}
            options={[
              { value: "system", label: t("system") },
              { value: "day", label: t("day") },
              { value: "night", label: t("night") },
            ]}
          />
          <p className="text-sm text-muted-foreground">{H.autoSave}</p>
        </SettingsCardBody>
      </SettingsCard>
      <SettingsCard>
        <SettingsCardHeader title={L.density} description={H.densityDescription} />
        <SettingsCardBody>
          <RadioGroup
            value={density}
            disabled={pending}
            onValueChange={(value) => {
              if (value === "comfortable" || value === "compact") {
                setDensity(value);
                setSaved(false);
              }
            }}
            aria-label={L.density}
            className="flex flex-wrap gap-5"
          >
            {(["comfortable", "compact"] as const).map((value) => (
              <div key={value} className="flex items-center gap-2">
                <RadioGroupItem id={`${id}-${value}`} value={value} />
                <label htmlFor={`${id}-${value}`} className="text-sm">
                  {value === "comfortable" ? L.comfortable : L.compact}
                </label>
              </div>
            ))}
          </RadioGroup>
          <p className="mt-3 text-sm text-muted-foreground">{H.saveToApply}</p>
        </SettingsCardBody>
        <SettingsCardFooter>
          {saved && (
            <span role="status" className="me-auto text-sm text-muted-foreground">
              {L.saved}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            disabled={pending || density === savedDensity}
            onClick={() => void save()}
          >
            {L.save}
          </Button>
        </SettingsCardFooter>
      </SettingsCard>
    </>
  );
}
