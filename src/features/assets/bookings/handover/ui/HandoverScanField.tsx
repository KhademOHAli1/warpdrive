"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SalesInput } from "@/features/inventory/sales/ui/SalesFields";
import type { HandoverWords } from "./messages";

export type ScanFeedback =
  | "scanAdded"
  | "scanDuplicate"
  | "scanIneligible"
  | "scanReturnAdded"
  | "scanReturnIneligible"
  | "scanChoose";

export function HandoverScanField({
  pending,
  onScan,
  onScanning,
  unavailable,
  words: t,
}: {
  pending: boolean;
  onScan: (code: string) => Promise<ScanFeedback>;
  onScanning: (value: boolean) => void;
  unavailable: "scanIneligible" | "scanReturnIneligible";
  words: HandoverWords;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const active = useRef(false);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);

  async function scan() {
    if (code.trim() === "" || pending || active.current) return;
    active.current = true;
    setScanning(true);
    onScanning(true);
    try {
      setFeedback(await onScan(code.trim()));
    } catch {
      setFeedback(unavailable);
    } finally {
      setCode("");
      active.current = false;
      setScanning(false);
      onScanning(false);
      input.current?.focus();
    }
  }

  return (
    <div className="space-y-1 rounded-md border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <SalesInput
            ref={input}
            label={t.code}
            data-handover-scan
            value={code}
            maxLength={4096}
            autoComplete="off"
            spellCheck={false}
            readOnly={scanning}
            disabled={pending}
            onChange={(event) => setCode(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void scan();
              }
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={pending || scanning || code.trim() === ""}
          onClick={() => void scan()}
        >
          {t.addScan}
        </Button>
      </div>
      <p
        aria-live="polite"
        data-handover-scan-result={feedback ?? undefined}
        className="text-xs text-muted-foreground"
      >
        {scanning ? t.scanning : feedback === null ? null : t[feedback]}
      </p>
    </div>
  );
}
