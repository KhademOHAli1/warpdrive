"use client";

import { Braces, Sparkles } from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type { readWorkflowRuntime } from "@/features/workflows/v2/runtime";
import {
  saveWorkflowLogicFunctionAction,
  saveWorkflowRuntimeAction,
} from "@/features/workflows/v2/workflowRuntimeActions";
import { workflowRuntimeMessages } from "@/features/workflows/v2/workflowRuntimeMessages";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardFooter,
  SettingsCardHeader,
} from "../SettingsSurface";

type Snapshot = Extract<Awaited<ReturnType<typeof readWorkflowRuntime>>, { ok: true }>["value"];
type Messages = ReturnType<typeof workflowRuntimeMessages>;
function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5 text-sm">
      {id === undefined ? (
        <span className="font-medium">{label}</span>
      ) : (
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
      )}
      {children}
      {hint === undefined ? null : <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
function SaveStatus({ message, error }: { message: string | null; error: boolean }) {
  return message === null ? null : (
    <p
      role={error ? "alert" : "status"}
      className={
        error ? "me-auto text-sm text-destructive" : "me-auto text-sm text-muted-foreground"
      }
    >
      {message}
    </p>
  );
}
function AiConnection({ initial, L }: { initial: Snapshot; L: Messages }) {
  const [state, setState] = useState(initial);
  const [url, setUrl] = useState(initial.aiBaseUrl);
  const [models, setModels] = useState(initial.aiModels.join("\n"));
  const [model, setModel] = useState(initial.aiDefaultModel);
  const [key, setKey] = useState("");
  const [remove, setRemove] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const lock = useRef(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setNotice(null);
    try {
      const result = await saveWorkflowRuntimeAction(
        {
          aiBaseUrl: url.trim(),
          aiModels: models
            .split("\n")
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
          aiDefaultModel: model.trim(),
          ...(key.length > 0 ? { aiApiKey: key } : {}),
          removeAiKey: remove,
        },
        readCsrfToken(),
      );
      if (!result.ok) {
        setNotice({
          message: result.error.id === "E_WORKFLOW_RUNTIME_MODEL" ? L.invalidModel : L.failed,
          error: true,
        });
        return;
      }
      setState(result.value);
      setKey("");
      setRemove(false);
      setNotice({ message: L.saved, error: false });
    } catch {
      setNotice({ message: L.failed, error: true });
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <SettingsCard>
      <form
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <SettingsCardHeader
          icon={<Sparkles className="size-4" aria-hidden="true" />}
          title={L.ai}
          description={L.aiDescription}
        />
        <SettingsCardBody className="grid gap-4">
          <Field label={L.endpoint} id="runtime-endpoint">
            <Input
              id="runtime-endpoint"
              type="url"
              dir="ltr"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={L.endpointExample}
              maxLength={2000}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={L.models} id="runtime-models" hint={L.modelsHint}>
              <Textarea
                id="runtime-models"
                dir="ltr"
                value={models}
                onChange={(event) => setModels(event.target.value)}
                rows={3}
              />
            </Field>
            <Field label={L.defaultModel} id="runtime-defaultModel">
              <Input
                id="runtime-defaultModel"
                dir="ltr"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                maxLength={200}
              />
            </Field>
          </div>
          <Field label={L.key} id="runtime-key" hint={state.hasAiKey ? L.keyStored : L.keyMissing}>
            <Input
              id="runtime-key"
              type="password"
              dir="ltr"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="new-password"
              maxLength={8192}
              disabled={remove}
            />
          </Field>
          {state.hasAiKey ? (
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id="runtime-remove-key"
                label={L.removeKey}
                checked={remove}
                onCheckedChange={setRemove}
              />
              <label htmlFor="runtime-remove-key">{L.removeKey}</label>
            </div>
          ) : null}
        </SettingsCardBody>
        <SettingsCardFooter>
          <SaveStatus message={notice?.message ?? null} error={notice?.error ?? false} />
          <Button type="submit" disabled={pending}>
            {pending ? L.pending : L.save}
          </Button>
        </SettingsCardFooter>
      </form>
    </SettingsCard>
  );
}
const schema = JSON.stringify(
  { type: "object", properties: {}, additionalProperties: true },
  null,
  2,
);
const empty = {
  name: "",
  description: "",
  sourceCode: "function main(input) {\n  return input;\n}",
  inputSchema: schema,
  outputSchema: schema,
};
function LogicFunctions({ initial, L }: { initial: Snapshot; L: Messages }) {
  const format = useFormatters();
  const [functions, setFunctions] = useState(initial.functions);
  const [revision, setRevision] = useState("");
  const [draft, setDraft] = useState(empty);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const lock = useRef(false);
  function choose(id: string) {
    setRevision(id);
    setNotice(null);
    const prior = functions.find((row) => row.id === id);
    setDraft(
      prior === undefined
        ? empty
        : {
            name: prior.name,
            description: prior.description,
            sourceCode: prior.sourceCode,
            inputSchema: JSON.stringify(prior.inputSchema, null, 2),
            outputSchema: JSON.stringify(prior.outputSchema, null, 2),
          },
    );
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    let inputSchema: unknown, outputSchema: unknown;
    try {
      inputSchema = JSON.parse(draft.inputSchema);
      outputSchema = JSON.parse(draft.outputSchema);
    } catch {
      setNotice({ message: L.invalidJson, error: true });
      return;
    }
    const prior = functions.find((row) => row.id === revision);
    lock.current = true;
    setPending(true);
    setNotice(null);
    try {
      const result = await saveWorkflowLogicFunctionAction(
        {
          ...draft,
          inputSchema,
          outputSchema,
          ...(prior !== undefined ? { familyId: prior.familyId } : {}),
        },
        readCsrfToken(),
      );
      if (!result.ok) {
        setNotice({ message: L.failed, error: true });
        return;
      }
      setFunctions(result.value.functions);
      setRevision(result.value.functions[0]?.id ?? "");
      setNotice({ message: L.saved, error: false });
    } catch {
      setNotice({ message: L.failed, error: true });
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <SettingsCard>
      <form
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <SettingsCardHeader
          icon={<Braces className="size-4" aria-hidden="true" />}
          title={L.functions}
          description={L.functionsDescription}
        />
        <SettingsCardBody className="grid gap-4">
          <Field label={L.selectRevision}>
            <Select
              ariaLabel={L.selectRevision}
              value={revision}
              onChange={choose}
              options={[
                { value: "", label: L.newFunction },
                ...functions.map((row) => ({
                  value: row.id,
                  label: `${row.name} · ${format.number(row.revision)}`,
                })),
              ]}
            />
          </Field>
          <Field label={L.name} id="runtime-name">
            <Input
              id="runtime-name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              maxLength={120}
              required
            />
          </Field>
          <Field label={L.summary} id="runtime-summary">
            <Input
              id="runtime-summary"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              maxLength={2000}
            />
          </Field>
          <Field label={L.code} id="runtime-code">
            <Textarea
              id="runtime-code"
              className="font-mono"
              dir="ltr"
              rows={8}
              value={draft.sourceCode}
              onChange={(event) => setDraft({ ...draft, sourceCode: event.target.value })}
              maxLength={50_000}
              spellCheck={false}
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={L.inputSchema} id="runtime-inputSchema">
              <Textarea
                id="runtime-inputSchema"
                className="font-mono"
                dir="ltr"
                rows={6}
                value={draft.inputSchema}
                onChange={(event) => setDraft({ ...draft, inputSchema: event.target.value })}
                spellCheck={false}
                required
              />
            </Field>
            <Field label={L.outputSchema} id="runtime-outputSchema">
              <Textarea
                id="runtime-outputSchema"
                className="font-mono"
                dir="ltr"
                rows={6}
                value={draft.outputSchema}
                onChange={(event) => setDraft({ ...draft, outputSchema: event.target.value })}
                spellCheck={false}
                required
              />
            </Field>
          </div>
        </SettingsCardBody>
        <SettingsCardFooter>
          <SaveStatus message={notice?.message ?? null} error={notice?.error ?? false} />
          <Button type="submit" disabled={pending}>
            {pending ? L.pending : L.publish}
          </Button>
        </SettingsCardFooter>
      </form>
    </SettingsCard>
  );
}
export function WorkflowRuntimeClient({ initial }: { initial: Snapshot }) {
  const L = workflowRuntimeMessages(useLocale());
  return (
    <>
      <AiConnection initial={initial} L={L} />
      <LogicFunctions initial={initial} L={L} />
    </>
  );
}
