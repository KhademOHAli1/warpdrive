"use client";
import { useState } from "react";
import type { Installation, Overview } from "../contracts";
import { useWorkMessages } from "../messages";
import { PresetSetup } from "./PresetSetup";
import { UndoInstallation } from "./UndoInstallation";
export function PresetInstaller({
  data,
  actorId,
  changed,
}: {
  data: Overview;
  actorId: string;
  changed: () => void;
}) {
  const m = useWorkMessages();
  const [receipts, setReceipts] = useState<Installation[]>([]);
  const installations = new Map(data.installations.map((entry) => [entry.id, entry]));
  for (const receipt of receipts)
    if (!installations.has(receipt.id)) installations.set(receipt.id, receipt);
  return (
    <div className="space-y-5">
      <h2 className="text-base font-semibold">{m.presets}</h2>
      <p className="text-sm text-muted-foreground">{m.presetHint}</p>
      {data.catalog.map((preset) => (
        <details key={`${preset.id}:${preset.version}`} className="rounded-lg border p-5">
          <summary className="cursor-pointer font-medium">
            {`${preset.name} · ${m.version} ${preset.version}`}
          </summary>
          <p className="my-4 text-sm text-muted-foreground">{preset.description}</p>
          <PresetSetup
            preset={preset}
            data={data}
            actorId={actorId}
            installed={(value) => {
              setReceipts([...receipts, value]);
              changed();
            }}
          />
        </details>
      ))}
      {installations.size > 0 ? (
        <div className="space-y-3">
          <h2 className="text-base font-semibold">{m.receipts}</h2>
          {[...installations.values()].map((installation) => (
            <UndoInstallation
              key={installation.id}
              installation={installation}
              actorId={`${data.workspaceScope}:${actorId}`}
              changed={changed}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
