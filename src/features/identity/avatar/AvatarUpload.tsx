"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  confirmAvatarUploadAction,
  removeAvatarAction,
  requestAvatarUploadAction,
} from "./avatarActions";
import { AVATAR_CONTENT_TYPES, AVATAR_MAX_BYTES, isAvatarContentType } from "./avatarStorage";

interface AvatarUploadProps {
  name: string;
  avatarUrl: string | null;
}

// Profile avatar control: shows the current avatar (or colored initials) and drives the
// presigned-upload handshake (request -> POST bytes -> confirm) with a client-side size/type
// guard mirroring the server. Kept small; the handshake logic is the same shape as AttachButton.
export function AvatarUpload({ name, avatarUrl }: AvatarUploadProps): React.ReactNode {
  const L = useSettingsMessages();

  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File): Promise<string | null> {
    if (!isAvatarContentType(file.type)) return L.photoInvalidType;
    if (file.size > AVATAR_MAX_BYTES) return L.photoTooLarge;

    const csrf = readCsrfToken();
    const requested = await requestAvatarUploadAction(
      { contentType: file.type, size: file.size },
      csrf,
    );
    if (!requested.ok) return L.photoFailed;

    const form = new FormData();
    for (const [k, v] of Object.entries(requested.value.post.fields)) form.append(k, v);
    form.append("file", file);
    const uploaded = await fetch(requested.value.post.url, { method: "POST", body: form });
    if (!uploaded.ok) return L.photoFailed;

    const confirmed = await confirmAvatarUploadAction(csrf);
    if (!confirmed.ok) return L.photoFailed;
    return null;
  }

  async function handleFiles(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (file === undefined) return;
    setError(null);
    setBusy(true);
    try {
      const message = await upload(file);
      if (message !== null) {
        setError(message);
        return;
      }
      router.refresh();
    } catch {
      setError(L.photoFailed);
    } finally {
      setBusy(false);
      if (inputRef.current !== null) inputRef.current.value = "";
    }
  }

  async function remove(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const r = await removeAvatarAction(readCsrfToken());
      if (!r.ok) {
        setError(L.photoFailed);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-medium">{L.photo}</span>
      <div className="flex items-center gap-3">
        <Avatar name={name} src={avatarUrl} className="h-14 w-14 text-lg" />
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="min-h-10 px-3"
            >
              {avatarUrl !== null ? L.changePhoto : L.uploadPhoto}
            </Button>
            {avatarUrl !== null && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void remove()}
                className="min-h-10 px-3 text-muted-foreground hover:text-foreground"
              >
                {L.removePhoto}
              </Button>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{L.photoHint}</span>
        </div>
      </div>
      {error !== null && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={AVATAR_CONTENT_TYPES.join(",")}
        onChange={(e) => void handleFiles(e.target.files)}
      />
    </div>
  );
}
