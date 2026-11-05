"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type {
  BlockJson,
  BlockOutput,
  WorkflowV2Run,
  WorkflowV2RunDetail,
  WorkflowV2Wait,
} from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  cancelWorkflowV2RunAction,
  listWorkflowV2RunsAction,
  readWorkflowV2RunAction,
  resumeWorkflowV2FormAction,
} from "../actions";
import { StudioOutput } from "./StudioOutput";
import { asArray, asObject, textValue } from "./studioModel";

export function ResponseForm({
  wait,
  disabled,
  onSubmit,
}: {
  wait: Pick<WorkflowV2Wait, "id" | "kind" | "config">;
  disabled: boolean;
  onSubmit: (response: BlockOutput) => void;
}) {
  const L = useSharedBlocksMessages();
  const [response, setResponse] = useState<BlockOutput>({});
  const fields = asArray(wait.config.fields).map(asObject);
  function update(key: string, value: BlockJson) {
    setResponse((current) => ({ ...current, [key]: value }));
  }
  if (wait.kind === "chat")
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-medium">{textValue(wait.config.title)}</h3>
        <p className="whitespace-pre-wrap text-xs">{textValue(wait.config.message)}</p>
        <div className="flex gap-2">
          <Button size="sm" disabled={disabled} onClick={() => onSubmit({ approved: true })}>
            {L.approve}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onSubmit({ approved: false })}
          >
            {L.reject}
          </Button>
        </div>
      </div>
    );
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(response);
      }}
    >
      <p className="text-xs text-muted-foreground">{textValue(wait.config.instructions)}</p>
      {fields.map((field) => {
        const name = textValue(field.name);
        const label = textValue(field.label) || name;
        const value = response[name];
        const options = asArray(field.options)
          .filter((option): option is string => typeof option === "string")
          .map((option) => ({ value: option, label: option }));
        return (
          <BlockField key={textValue(field.id)} label={label}>
            {field.type === "SELECT" ? (
              <Select
                ariaLabel={label}
                value={textValue(value)}
                disabled={disabled}
                options={[{ value: "", label: L.fields.none ?? "" }, ...options]}
                onChange={(next) => update(name, next)}
              />
            ) : field.type === "MULTI_SELECT" ? (
              <div className="space-y-1">
                {options.map((option) => {
                  const selected = asArray(value).includes(option.value);
                  return (
                    <Button
                      key={option.value}
                      size="sm"
                      variant={selected ? "outline" : "ghost"}
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() =>
                        update(
                          name,
                          selected
                            ? asArray(value).filter((item) => item !== option.value)
                            : [...asArray(value), option.value],
                        )
                      }
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            ) : field.type === "TEXT" ? (
              <Textarea
                aria-label={label}
                value={textValue(value)}
                disabled={disabled}
                required={field.required === true}
                onChange={(event) => update(name, event.target.value)}
                className="text-xs"
              />
            ) : (
              <Input
                aria-label={label}
                value={textValue(value)}
                disabled={disabled}
                type={field.type === "DATE" ? "date" : field.type === "NUMBER" ? "number" : "text"}
                required={field.required === true}
                onChange={(event) =>
                  update(
                    name,
                    field.type === "NUMBER" && event.target.value !== ""
                      ? Number(event.target.value)
                      : event.target.value,
                  )
                }
                className="h-9 text-xs"
              />
            )}
          </BlockField>
        );
      })}
      <Button type="submit" size="sm" disabled={disabled || fields.length === 0}>
        {L.submit}
      </Button>
    </form>
  );
}
export function WorkflowRunPanel({
  workflowId,
  initialRunId,
}: {
  workflowId: string;
  initialRunId?: string;
}) {
  const L = useSharedBlocksMessages();
  const format = useFormatters();
  const [runs, setRuns] = useState<WorkflowV2Run[]>([]);
  const [selected, setSelected] = useState<string | null>(initialRunId ?? null);
  const [detail, setDetail] = useState<WorkflowV2RunDetail | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(true);
  const request = useRef(0);
  const lock = useRef(false);
  const refresh = useCallback(async () => {
    const generation = ++request.current;
    try {
      const list = await listWorkflowV2RunsAction(workflowId);
      if (generation !== request.current) return;
      if (!list.ok) {
        setError(true);
        return;
      }
      setRuns(list.value);
      const id = selected ?? list.value[0]?.id;
      if (id !== undefined) {
        const result = await readWorkflowV2RunAction(id);
        if (generation !== request.current) return;
        if (result.ok) {
          setDetail(result.value);
        } else {
          setDetail(null);
          setError(true);
          return;
        }
      } else setDetail(null);
      setError(false);
    } catch {
      if (generation === request.current) setError(true);
    } finally {
      if (generation === request.current) setPending(false);
    }
  }, [selected, workflowId]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => (active ? refresh() : undefined));
    return () => {
      active = false;
      request.current += 1;
    };
  }, [refresh]);
  async function respond(waitId: string, response: BlockOutput) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      const result = await resumeWorkflowV2FormAction(
        { waitId, response, requestKey: crypto.randomUUID() },
        readCsrfToken(),
      );
      if (!result.ok) {
        setError(true);
        return;
      }
      await refresh();
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function cancel() {
    const id = detail?.run.id;
    if (lock.current || id === undefined) return;
    lock.current = true;
    setPending(true);
    try {
      const result = await cancelWorkflowV2RunAction(id, readCsrfToken());
      if (result.ok) await refresh();
      else setError(true);
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  const status = (value: string) => L.runStates[value] ?? L.failed;
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{L.history}</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void refresh();
          }}
        >
          {L.refresh}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {L.failed}
        </p>
      )}
      <Select
        ariaLabel={L.runId}
        value={selected ?? detail?.run.id ?? ""}
        disabled={pending}
        options={
          runs.length === 0
            ? [{ value: "", label: L.noRuns }]
            : runs.map((run) => ({
                value: run.id,
                label: `${format.dateTime(run.createdAt)} · ${status(run.status)}`,
              }))
        }
        onChange={(id) => {
          if (id === "" || id === (selected ?? detail?.run.id)) return;
          setPending(true);
          setSelected(id);
          setDetail(null);
        }}
      />
      {detail !== null && (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {status(detail.run.status)} · {detail.run.mode === "test" ? L.test : L.run}
            </p>
            {["queued", "running", "waiting"].includes(detail.run.status) && (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => void cancel()}>
                {L.stop}
              </Button>
            )}
          </div>
          {detail.waits
            .filter((wait) => wait.status === "open")
            .map((wait) => (
              <section key={wait.id} className="space-y-3 border-t pt-3">
                <h3 className="text-xs font-medium">{L.waiting}</h3>
                {wait.kind === "form" || wait.kind === "chat" ? (
                  wait.config.redacted === true ? (
                    <p className="text-xs text-muted-foreground">{L.responseRestricted}</p>
                  ) : (
                    <ResponseForm
                      wait={wait}
                      disabled={pending}
                      onSubmit={(response) => void respond(wait.id, response)}
                    />
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {wait.wakeAt === null ? L.waiting : format.dateTime(wait.wakeAt)}
                  </p>
                )}
              </section>
            ))}
          <div className="space-y-3">
            {detail.executions.map((execution) => (
              <section key={execution.id} className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium">
                  {execution.nodeId} · {status(execution.status)}
                </p>
                {execution.output !== null && execution.output.redacted !== true && (
                  <StudioOutput value={execution.output} />
                )}
                {execution.errorId !== null && (
                  <p className="text-xs text-destructive">{L.failed}</p>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
