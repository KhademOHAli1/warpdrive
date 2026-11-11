"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  type BlockJson,
  isNewsletterTrigger,
  TRIGGER_BLOCK_KINDS,
  type WorkflowV2Document,
  type WorkflowV2Studio,
  type WorkflowV2Trigger,
} from "@/features/blocks/contracts";
import { newsletterListId } from "@/features/blocks/schemas";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { MASK_CLASS } from "@/features/observability/replayMasking";
import { readCsrfToken } from "@/utils/csrfCookie";
import { rotateWorkflowV2WebhookAction } from "../actions";
import styles from "./studioInspector.module.css";
import { asArray, textValue } from "./studioModel";

export function triggerLabelKey(type: WorkflowV2Trigger["type"]) {
  if (type === "record.created_or_updated") return "upserted";
  if (type.startsWith("record.")) return type.slice(7);
  return type === "schedule" ? "cron" : type;
}
export function initialTriggerConfig(type: WorkflowV2Trigger["type"]): Record<string, BlockJson> {
  if (isNewsletterTrigger(type)) return {};
  if (type.startsWith("record.")) return { objectName: "deal", updatedFields: [] };
  if (type === "manual") return { availability: "global" };
  if (type === "schedule") return { mode: "interval", intervalMinutes: 60 };
  return { authentication: "api_key", responseSchema: { type: "object", properties: {} } };
}
function WebhookFields({
  document,
  disabled,
  onRotated,
}: {
  document: WorkflowV2Document;
  disabled: boolean;
  onRotated: (document: WorkflowV2Document) => void;
}) {
  const L = useSharedBlocksMessages();
  const [key, setKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function rotate() {
    if (pending || disabled) return;
    setPending(true);
    setError(false);
    try {
      const result = await rotateWorkflowV2WebhookAction(
        { id: document.id, expectedRevision: document.revision },
        readCsrfToken(),
      );
      if (result.ok) {
        setKey(result.value.apiKey);
        onRotated(result.value.document);
      } else setError(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-3">
      <BlockField label={L.fields.url ?? ""}>
        <Input
          aria-label={L.fields.url}
          readOnly
          value={`/api/workflows-v2/${document.id}`}
          className="text-xs"
        />
        <p className="text-[10px] text-muted-foreground">{L.webhookMethod}</p>
      </BlockField>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || pending}
        onClick={() => void rotate()}
      >
        {L.rotateKey}
      </Button>
      {key !== null && (
        <BlockField label={L.oneTimeKey}>
          <Input
            aria-label={L.oneTimeKey}
            value={key}
            readOnly
            className={`${MASK_CLASS} font-mono text-xs`}
          />
          <p className="text-[11px] text-muted-foreground">{L.oneTimeKeyHint}</p>
        </BlockField>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {L.failed}
        </p>
      )}
    </div>
  );
}
export function StudioTrigger({
  document,
  studio,
  disabled,
  dirty,
  onChange,
  onRotated,
}: {
  document: WorkflowV2Document;
  studio: WorkflowV2Studio;
  disabled: boolean;
  dirty: boolean;
  onChange: (trigger: WorkflowV2Trigger) => void;
  onRotated: (document: WorkflowV2Document) => void;
}) {
  const L = useSharedBlocksMessages();
  const trigger = document.draft.trigger;
  const config = trigger.config;
  function update(patch: Record<string, BlockJson>) {
    onChange({ ...trigger, config: { ...config, ...patch } });
  }
  const object = studio.objects.find((item) => item.name === textValue(config.objectName));
  return (
    <div className={styles.content}>
      <BlockField label={L.changeTrigger}>
        <Select
          ariaLabel={L.changeTrigger}
          value={trigger.type}
          disabled={disabled}
          options={TRIGGER_BLOCK_KINDS.filter(
            (type) =>
              !isNewsletterTrigger(type) ||
              studio.newsletterEvents === true ||
              type === trigger.type,
          ).map((type) => ({
            value: type,
            label: L.triggers[triggerLabelKey(type)] ?? type,
          }))}
          onChange={(type) => {
            const selected = TRIGGER_BLOCK_KINDS.find((kind) => kind === type);
            if (selected !== undefined)
              onChange({ type: selected, config: initialTriggerConfig(selected) });
          }}
        />
      </BlockField>
      {(trigger.type === "newsletter.consent.confirmed" ||
        trigger.type === "newsletter.consent.revoked") && (
        <BlockField label={L.fields.listId ?? ""}>
          <Input
            aria-label={L.fields.listId}
            type="number"
            min={1}
            max={2_147_483_647}
            value={textValue(config.listId)}
            disabled={disabled}
            onChange={(event) => {
              const parsed = newsletterListId.safeParse(Number(event.target.value));
              const raw = event.target.value;
              onChange({
                ...trigger,
                config: raw === "" ? {} : { listId: parsed.success ? parsed.data : raw },
              });
            }}
          />
        </BlockField>
      )}
      {(trigger.type.startsWith("record.") ||
        (trigger.type === "manual" && config.availability !== "global")) && (
        <BlockField label={L.fields.objectName ?? ""}>
          <Select
            ariaLabel={L.fields.objectName ?? ""}
            value={textValue(config.objectName)}
            disabled={disabled}
            options={studio.objects.map((item) => ({ value: item.name, label: item.label }))}
            onChange={(objectName) => update({ objectName })}
          />
        </BlockField>
      )}
      {(trigger.type === "record.updated" || trigger.type === "record.created_or_updated") && (
        <BlockField label={L.fields.watchedFields ?? ""}>
          <div className="space-y-1">
            {object?.fields
              .filter((field) => field.readable)
              .map((field) => {
                const selected = asArray(config.updatedFields).includes(field.key);
                return (
                  <Button
                    key={field.key}
                    variant={selected ? "outline" : "ghost"}
                    size="sm"
                    className="h-auto min-h-8 w-full justify-start text-start text-xs font-normal"
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() =>
                      update({
                        updatedFields: selected
                          ? asArray(config.updatedFields).filter((key) => key !== field.key)
                          : [...asArray(config.updatedFields), field.key],
                      })
                    }
                  >
                    {field.label}
                  </Button>
                );
              })}
          </div>
        </BlockField>
      )}
      {trigger.type === "manual" && (
        <BlockField label={L.fields.availability ?? ""}>
          <Select
            ariaLabel={L.fields.availability ?? ""}
            value={textValue(config.availability) || "global"}
            disabled={disabled}
            options={["global", "single", "bulk"].map((value) => ({
              value,
              label: L.fields[value] ?? value,
            }))}
            onChange={(availability) =>
              update({
                availability,
                ...(availability === "global"
                  ? {}
                  : { objectName: studio.objects[0]?.name ?? "deal" }),
              })
            }
          />
        </BlockField>
      )}
      {trigger.type === "schedule" && (
        <>
          <BlockField label={L.fields.type ?? ""}>
            <Select
              ariaLabel={L.fields.type ?? ""}
              value={textValue(config.mode) || "interval"}
              disabled={disabled}
              options={[
                { value: "interval", label: L.fields.interval ?? "" },
                { value: "cron", label: L.fields.cron ?? "" },
              ]}
              onChange={(mode) =>
                update(
                  mode === "cron"
                    ? { mode, cron: "0 9 * * 1-5", timeZone: "UTC" }
                    : { mode, intervalMinutes: 60 },
                )
              }
            />
          </BlockField>
          <BlockField
            label={config.mode === "cron" ? (L.fields.cron ?? "") : (L.fields.minutes ?? "")}
          >
            <Input
              aria-label={config.mode === "cron" ? L.fields.cron : L.fields.minutes}
              value={textValue(config[config.mode === "cron" ? "cron" : "intervalMinutes"])}
              disabled={disabled}
              onChange={(event) =>
                update(
                  config.mode === "cron"
                    ? { cron: event.target.value }
                    : { intervalMinutes: Number(event.target.value) },
                )
              }
              className="h-9 text-xs"
            />
          </BlockField>
          {config.mode === "cron" && (
            <BlockField label={L.fields.timeZone ?? ""}>
              <Input
                aria-label={L.fields.timeZone}
                value={textValue(config.timeZone)}
                disabled={disabled}
                onChange={(event) => update({ timeZone: event.target.value })}
                className="h-9 text-xs"
              />
            </BlockField>
          )}
        </>
      )}
      {trigger.type === "webhook" && (
        <>
          <BlockField label={L.fields.authentication ?? ""}>
            <Select
              ariaLabel={L.fields.authentication ?? ""}
              value={textValue(config.authentication) || "api_key"}
              disabled={disabled}
              options={[
                { value: "api_key", label: L.fields.apiKey ?? "" },
                { value: "none", label: L.fields.none ?? "" },
              ]}
              onChange={(authentication) => update({ authentication })}
            />
          </BlockField>
          <WebhookFields document={document} disabled={disabled || dirty} onRotated={onRotated} />
          {dirty && <p className="text-[11px] text-muted-foreground">{L.saveBeforeKey}</p>}
        </>
      )}
    </div>
  );
}
