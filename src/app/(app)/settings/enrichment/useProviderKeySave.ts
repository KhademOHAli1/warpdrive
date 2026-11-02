import { useRef, useState } from "react";

export function useProviderKeySave(onSaveKey: (apiKey: string) => Promise<boolean>) {
  const [draftKey, setDraftKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  async function save(): Promise<void> {
    const trimmed = draftKey.trim();
    if (trimmed === "" || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setFailed(false);
    try {
      const saved = await onSaveKey(trimmed);
      if (saved) setDraftKey("");
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function updateDraft(value: string): void {
    setDraftKey(value);
    setFailed(false);
  }

  return { draftKey, updateDraft, saving, failed, save };
}
