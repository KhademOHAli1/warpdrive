"use client";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { Button } from "@/components/ui/Button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { type PrefActionResult, setDensityAction } from "@/features/identity/preferencesActions";
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

type SaveStatus = "idle" | "saving" | "saved" | "error";

// Keep both live regions mounted so updates can be announced without moving focus.
function AppearanceSaveFeedback({
  status,
  label,
  saving,
  saved,
  error,
}: {
  status: SaveStatus;
  label: string;
  saving: string;
  saved: string;
  error: string;
}) {
  return (
    <div className="min-w-0 text-sm">
      <p role="status" aria-label={label} aria-atomic="true" className="text-muted-foreground">
        {status === "saving" ? saving : status === "saved" ? saved : ""}
      </p>
      <p role="alert" aria-label={label} aria-atomic="true" className="text-destructive">
        {status === "error" ? error : ""}
      </p>
    </div>
  );
}

export function AppearanceSettings({
  density: storedDensity,
  appearance,
}: {
  density: Density;
  appearance: Appearance;
}) {
  const L = useSettingsMessages();
  const H = L._hierarchy;
  const F = H.appearanceFeedback;
  const t = useAppTranslations("shell.appearance");
  const choice = useAppearanceChoice(appearance);
  const router = useRouter();
  const reportError = useActionError();
  const id = useId();
  const [density, setDensity] = useState(storedDensity);
  const [savedDensity, setSavedDensity] = useState(storedDensity);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saving = useRef(false);
  const themeControl = useRef<HTMLDivElement>(null);
  const pending = status === "saving";

  async function save(): Promise<void> {
    if (saving.current || density === savedDensity) return;
    saving.current = true;
    const nextDensity = density;
    setStatus("saving");
    let result: PrefActionResult;
    try {
      result = await setDensityAction({ density: nextDensity }, readCsrfToken());
    } catch {
      setStatus("error");
      reportError();
      return;
    } finally {
      saving.current = false;
    }
    if (!result.ok) {
      setStatus("error");
      reportError(result.error.id);
      return;
    }
    setSavedDensity(nextDensity);
    setStatus("saved");
    try {
      router.refresh();
    } catch {
      // A failed refresh does not undo the save; the generic error would wrongly say it failed.
    }
  }

  function retryTheme(): void {
    // Retry disappears while saving; return keyboard focus to the stable theme control first.
    themeControl.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
    choice.retry();
  }

  return (
    <>
      <SettingsCard>
        <SettingsCardHeader title={H.theme} description={H.themeDescription} />
        <SettingsCardBody className="space-y-3">
          <div ref={themeControl}>
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
          </div>
          <p className="text-sm text-muted-foreground">{H.autoSave}</p>
          <AppearanceSaveFeedback
            status={choice.status}
            label={H.theme}
            saving={F.themeSaving}
            saved={F.themeSaved}
            error={F.themeError}
          />
          {choice.status === "error" && (
            <Button type="button" size="sm" onClick={retryTheme}>
              {F.themeRetry}
            </Button>
          )}
        </SettingsCardBody>
      </SettingsCard>
      <SettingsCard>
        <SettingsCardHeader title={L.density} description={H.densityDescription} />
        <SettingsCardBody>
          <RadioGroup
            value={density}
            disabled={pending}
            onValueChange={(value) => {
              if (
                !saving.current &&
                value !== density &&
                (value === "comfortable" || value === "compact")
              ) {
                setDensity(value);
                setStatus("idle");
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
        <SettingsCardFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <div className="w-full min-w-0 sm:me-auto sm:w-auto sm:flex-1">
            <AppearanceSaveFeedback
              status={status}
              label={L.density}
              saving={F.densitySaving}
              saved={F.densitySaved}
              error={F.densityError}
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="self-end sm:self-auto"
            disabled={pending || density === savedDensity}
            onClick={() => void save()}
          >
            {status === "error" ? F.densityRetry : L.save}
          </Button>
        </SettingsCardFooter>
      </SettingsCard>
    </>
  );
}
