"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AvatarUpload } from "@/features/identity/avatar/AvatarUpload";
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
}

export function ProfileClient(props: ProfileClientProps): React.ReactNode {
  const L = useSettingsMessages();
  const router = useRouter();
  const nameFieldId = useId();
  const [draftName, setDraftName] = useState(props.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  async function saveName(): Promise<void> {
    setNameSaving(true);
    setNameSaved(false);
    setNameError(null);
    try {
      const r = await updateUserProfileAction({ name: draftName.trim() }, readCsrfToken());
      if (r.ok) {
        setNameSaved(true);
        router.refresh();
      } else setNameError(r.error.id);
    } catch {
      setNameError("");
    } finally {
      setNameSaving(false);
    }
  }

  return (
    <SettingsCard>
      <SettingsCardHeader
        title={L._extra.account_details}
        description={L._hierarchy.accountDetailsDescription}
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
            onChange={(e) => {
              setDraftName(e.target.value);
              setNameSaved(false);
            }}
          />
          {nameError !== null && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {nameError === "" ? L._errors.generic : L._extra.nameSaveError(nameError)}
            </p>
          )}
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium">{L.email}</span>
          <p className="text-sm text-muted-foreground">
            <bdi dir="auto">{props.email || "-"}</bdi>
          </p>
        </div>
      </SettingsCardBody>
      <SettingsCardFooter>
        {nameSaved && (
          <span role="status" className="me-auto text-sm text-muted-foreground">
            {L.saved}
          </span>
        )}
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={nameSaving}
          onClick={() => void saveName()}
        >
          {L.saveName}
        </Button>
      </SettingsCardFooter>
    </SettingsCard>
  );
}
