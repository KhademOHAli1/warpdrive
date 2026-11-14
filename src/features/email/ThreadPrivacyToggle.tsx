"use client";

import type React from "react";
import { useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { setThreadVisibilityAction } from "./threadVisibilityActions";
import { VisibilityControl } from "./VisibilityControl";

// The reader exposes this menu to the mailbox owner. The action re-checks ownership.
export function ThreadPrivacyToggle({
  threadId,
  visibility,
  onChanged,
}: {
  threadId: string;
  visibility: string;
  onChanged?: () => void;
}): React.ReactNode {
  const [busy, setBusy] = useState(false);
  const reportError = useActionError();

  async function set(next: "private" | "shared"): Promise<void> {
    if (next === visibility) return;
    setBusy(true);
    const res = await setThreadVisibilityAction(readCsrfToken(), { threadId, visibility: next });
    setBusy(false);
    if (res.ok) onChanged?.();
    else reportError(res.error.id);
  }

  return (
    <VisibilityControl
      variant="reader"
      value={visibility}
      disabled={busy}
      onChange={(next) => void set(next)}
    />
  );
}
