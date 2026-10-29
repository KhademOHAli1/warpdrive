"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useId, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { Select, type SelectOption } from "@/components/ui/Select";
import { AvatarUpload } from "@/features/identity/avatar/AvatarUpload";
import { updateProfilePreferencesAction } from "@/features/identity/preferencesActions";
import { updateUserProfileAction } from "@/features/identity/profileActions";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardFooter,
  SettingsCardHeader,
} from "../SettingsSurface";

interface ProfileClientProps {
  name: string;
  email: string;
  avatarUrl: string | null;
  timezone: string | null;
  density: "comfortable" | "compact";
}

// A small IANA subset for the dropdown; the value is stored verbatim. Full list is unnecessary.
const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Kyiv",
  "Asia/Tehran",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];
const TIMEZONE_NONE_VALUE = "timezone:none";

export function ProfileClient(props: ProfileClientProps): React.ReactNode {
  const L = useSettingsMessages();
  const TIMEZONE_OPTIONS: SelectOption[] = [
    { value: TIMEZONE_NONE_VALUE, label: L.timezoneNone },
    ...TIMEZONES.map((tz) => ({ value: tz, label: tz })),
  ];

  const router = useRouter();
  const reportError = useActionError();
  const [timezone, setTimezone] = useState<string>(props.timezone ?? "");
  const [density, setDensity] = useState(props.density);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  const nameFieldId = useId();
  const [draftName, setDraftName] = useState(props.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setPending(true);
    setSaved(false);
    const r = await updateProfilePreferencesAction(
      { timezone: timezone === "" ? null : timezone, density },
      readCsrfToken(),
    );
    setPending(false);
    if (r.ok) {
      setSaved(true);
      router.refresh();
    } else reportError(r.error.id);
  }

  async function saveName(): Promise<void> {
    setNameSaving(true);
    setNameSaved(false);
    setNameError(null);
    const r = await updateUserProfileAction({ name: draftName.trim() }, readCsrfToken());
    setNameSaving(false);
    if (r.ok) {
      setNameSaved(true);
      router.refresh();
    } else {
      setNameError(r.error.id);
    }
  }

  return (
    <SettingsCard>
      <SettingsCardHeader
        title={L._extra.account_details}
        description={L._extra.update_your_photo_display_name_timezone_and_interface_dens}
      />
      <SettingsCardBody className="space-y-5">
        <AvatarUpload name={props.name} avatarUrl={props.avatarUrl} />
        <div>
          <label htmlFor={nameFieldId} className="mb-1 block text-sm font-medium">
            {L.name}
          </label>
          <Input
            id={nameFieldId}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
          />
          {nameError !== null && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {L._extra.nameSaveError(nameError)}
            </p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={nameSaving}
              onClick={() => void saveName()}
            >
              {L.saveName}
            </Button>
            {nameSaved && <span className="text-sm text-muted-foreground">{L.saved}</span>}
          </div>
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium">{L.email}</span>
          <p className="text-sm text-muted-foreground">{props.email || "-"}</p>
        </div>

        <div className="block">
          <span className="mb-1 block text-sm font-medium">{L.timezone}</span>
          <Select
            ariaLabel={L.timezone}
            value={timezone}
            onChange={(value) => setTimezone(value === TIMEZONE_NONE_VALUE ? "" : value)}
            placeholder={L.timezoneNone}
            options={TIMEZONE_OPTIONS}
          />
        </div>

        <fieldset>
          <legend className="mb-1 block text-sm font-medium">{L.density}</legend>
          <RadioGroup
            value={density}
            onValueChange={(v) => setDensity(v as "comfortable" | "compact")}
            aria-label={L.density}
            className="flex gap-4 text-sm"
          >
            {(["comfortable", "compact"] as const).map((d) => (
              <div key={d} className="flex items-center gap-1.5">
                <RadioGroupItem value={d} id={`density-${d}`} />
                <label htmlFor={`density-${d}`} className="cursor-pointer">
                  {d === "comfortable" ? L.comfortable : L.compact}
                </label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
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
