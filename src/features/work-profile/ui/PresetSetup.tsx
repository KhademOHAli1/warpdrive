"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { useCompanyMessages } from "@/features/company-profile/messages";
import { CommandFeedback } from "@/features/company-profile/ui/CommandFeedback";
import { Section, TextField } from "@/features/company-profile/ui/Fields";
import { useDepartureGuard } from "@/features/company-profile/ui/useDepartureGuard";
import { useProfileCommand } from "@/features/company-profile/ui/useProfileApi";
import { useLocale } from "@/features/i18n/LocaleProvider";
import {
  applyAckSchema,
  commandSchema,
  type Installation,
  type Overview,
  type Preset,
  type Preview,
  previewSchema,
} from "../contracts";
import { useWorkMessages } from "../messages";
export function PresetSetup({
  preset,
  data,
  actorId,
  installed,
}: {
  preset: Preset;
  data: Overview;
  actorId: string;
  installed: (value: Installation) => void;
}) {
  const m = useWorkMessages();
  const c = useCompanyMessages();
  const locale = useLocale();
  const [selection, setSelection] = useState({
    sales: true,
    delivery: true,
    dealFields: true,
    activityTypes: true,
  });
  const [salesName, setSalesName] = useState(preset.sales.name);
  const [deliveryName, setDeliveryName] = useState(preset.delivery.name);
  const [preview, setPreview] = useState<Preview | null>(null);
  const inspect = useProfileCommand(
    `work:${data.workspaceScope}:${actorId}:preview:${preset.id}`,
    commandSchema,
    previewSchema,
    "/api/work-profile",
  );
  const apply = useProfileCommand(
    `work:${data.workspaceScope}:${actorId}:apply:${preset.id}`,
    commandSchema,
    applyAckSchema,
    "/api/work-profile",
  );
  const locked = inspect.busy || inspect.command !== null || apply.busy || apply.command !== null;
  useDepartureGuard(apply.command !== null, c.uncertain);
  const accept = (result: typeof applyAckSchema._output | null) => {
    if (result) {
      installed(result.installation);
      setPreview(null);
    }
  };
  return (
    <div className="space-y-4">
      <Section title={m.selection}>
        {(["sales", "delivery", "dealFields", "activityTypes"] as const).map((key) => (
          <div key={key} className="flex items-center gap-2 text-sm">
            <Checkbox
              label={key === "delivery" ? m.work : m[key]}
              checked={selection[key]}
              disabled={locked}
              onCheckedChange={(checked) => {
                setSelection({ ...selection, [key]: checked });
                setPreview(null);
              }}
            />
            {key === "delivery" ? m.work : m[key]}
          </div>
        ))}
        <TextField
          label={m.salesName}
          value={salesName}
          disabled={locked}
          maxLength={120}
          onChange={(value) => {
            setSalesName(value);
            setPreview(null);
          }}
        />
        <TextField
          label={m.deliveryName}
          value={deliveryName}
          disabled={locked}
          maxLength={120}
          onChange={(value) => {
            setDeliveryName(value);
            setPreview(null);
          }}
        />
      </Section>
      <div className="grid gap-4 rounded-md bg-muted/30 p-4 text-sm sm:grid-cols-2">
        <div>
          <h4 className="font-medium">{m.sales}</h4>
          <ol className="mt-2 list-inside list-decimal space-y-1">
            {preset.sales.stages.map((stage) => (
              <li key={stage}>{stage}</li>
            ))}
          </ol>
        </div>
        <div>
          <h4 className="font-medium">{m.work}</h4>
          <ol className="mt-2 list-inside list-decimal space-y-1">
            {preset.delivery.stages.map((stage) => (
              <li key={stage.key}>{stage.name}</li>
            ))}
          </ol>
          <ul className="mt-3 space-y-1">
            {preset.delivery.fields.map((field) => (
              <li key={field.key}>{field.label}</li>
            ))}
          </ul>
        </div>
      </div>
      <CommandFeedback
        state={inspect}
        retry={() => {
          void inspect.retry().then(setPreview);
        }}
        discard={inspect.discard}
      />
      <Button
        variant="outline"
        disabled={locked || !data.permissions.apply || !Object.values(selection).some(Boolean)}
        onClick={() => {
          void inspect
            .run({
              action: "preview",
              requestId: crypto.randomUUID(),
              expectedRevision: data.revision,
              presetId: preset.id,
              locale,
              selection,
              salesName,
              deliveryName,
            })
            .then(setPreview);
        }}
      >
        {m.preview}
      </Button>
      {preview ? (
        <div className="space-y-3 rounded-lg border p-4">
          <h4 className="font-semibold">{m.previewTitle}</h4>
          <ul className="space-y-2 text-sm">
            {preview.operations.map((operation) => (
              <li key={`${operation.kind}:${operation.key}`} className="flex justify-between gap-4">
                <span>{operation.name}</span>
                <span
                  className={
                    operation.disposition === "conflict"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {m[operation.disposition]}
                </span>
              </li>
            ))}
          </ul>
          {preview.conflicts.map((conflict) => (
            <p key={conflict} className="text-sm text-destructive">
              <bdi>{conflict}</bdi>
            </p>
          ))}
          <Button
            disabled={locked || preview.conflicts.length > 0 || !data.permissions.apply}
            onClick={() => {
              void apply
                .run({ action: "apply", requestId: crypto.randomUUID(), preview })
                .then(accept);
            }}
          >
            {m.apply}
          </Button>
        </div>
      ) : null}
      <CommandFeedback
        state={apply}
        retry={() => {
          void apply.retry().then(accept);
        }}
        discard={apply.discard}
        cancel={() => {
          void apply.cancel().then(accept);
        }}
      />
    </div>
  );
}
