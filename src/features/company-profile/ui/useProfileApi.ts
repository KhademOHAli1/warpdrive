"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { forget, ProfileApiError, profileRequest, remember, restored } from "./api";

export function useProfileResource<T>(url: string | null, schema: z.ZodType<T>) {
  const [success, setSuccess] = useState<{ url: string; data: T; version: number } | null>(null);
  const [fault, setFault] = useState<{ url: string; code: string } | null>(null);
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const abort = useCallback(() => active.current?.abort(), []);
  const reload = useCallback(() => {
    if (url === null) return Promise.resolve();
    const version = ++generation.current;
    abort();
    const controller = new AbortController();
    active.current = controller;
    return profileRequest(url, schema, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        setSuccess({ url, data, version });
        setFault(null);
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setFault({ url, code: cause instanceof ProfileApiError ? cause.code : "unavailable" });
      },
    );
  }, [abort, url, schema]);
  useEffect(() => {
    void reload();
    return abort;
  }, [abort, reload]);
  const current = success?.url === url ? success : null;
  const error = fault !== null && fault.url === url ? fault.code : null;
  return {
    data: current?.data ?? null,
    error,
    loading: url !== null && current === null && error === null,
    version: current?.version ?? null,
    reload,
  };
}

export function useProfileCommand<C, T>(
  key: string,
  commandSchema: z.ZodType<C>,
  resultSchema: z.ZodType<T>,
  url: string,
  transport?: (payload: C, signal: AbortSignal) => Promise<T>,
) {
  const [command, setCommand] = useState<C | null>(null);
  const [ack, setAck] = useState<T | null>(null);
  const [recovery, setRecovery] = useState(() => restored(`${key}:operation`, operationSchema));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(command !== null || recovery !== null);
  const [cancelBody, setCancelBody] = useState<unknown>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (command === null && recovery === null) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [command, recovery]);
  const execute = async (payload: C): Promise<T | null> => {
    if (active.current !== null) return null;
    const validated = commandSchema.safeParse(payload);
    if (!validated.success) {
      setError("invalid_input");
      return null;
    }
    setCommand(validated.data);
    const operation = operationSchema.safeParse(validated.data);
    if (operation.success && operation.data.action !== "preview")
      remember(`${key}:operation`, operation.data);
    setBusy(true);
    setError(null);
    setUncertain(false);
    const controller = new AbortController();
    active.current = controller;
    try {
      const result = await (transport
        ? transport(validated.data, controller.signal)
        : profileRequest(url, resultSchema, controller.signal, validated.data));
      forget(`${key}:operation`);
      setRecovery(null);
      setAck(result);
      setCommand(null);
      setUncertain(false);
      return result;
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof ProfileApiError ? cause.code : "unavailable");
        setUncertain(
          operation.success && operation.data.action !== "preview" && isUncertain(cause),
        );
      }
      return null;
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const recover = async (): Promise<T | null> => {
    if (recovery === null || active.current !== null) return null;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    active.current = controller;
    try {
      const path = url === "/api/company-profile" ? `${url}/operation/` : `${url}/operations/`;
      const schema =
        url === "/api/company-profile"
          ? resultSchema
          : z
              .object({ status: z.literal("complete"), data: resultSchema })
              .transform((value) => value.data);
      const result = await profileRequest(path + recovery.requestId, schema, controller.signal);
      setAck(result);
      setRecovery(null);
      setUncertain(false);
      forget(`${key}:operation`);
      return result;
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof ProfileApiError ? cause.code : "unavailable");
      return null;
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const cancel = async (): Promise<T | null> => {
    const original = operationSchema.safeParse(command ?? recovery);
    if (!original.success || active.current !== null) return null;
    const body =
      cancelBody ??
      (url === "/api/company-profile"
        ? {
            action: "cancel_operation",
            requestId: crypto.randomUUID(),
            operationId: original.data.requestId,
            operationAction: original.data.action,
          }
        : {
            action: "cancel_operation",
            requestId: crypto.randomUUID(),
            targetRequestId: original.data.requestId,
          });
    setCancelBody(body);
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    active.current = controller;
    try {
      const result = await profileRequest(url, cancellationSchema, controller.signal, body);
      let completed: T | null = null;
      if (result.status !== "canceled") {
        const parsed = resultSchema.safeParse(
          result.status === "complete" ? result.data : result.result,
        );
        if (!parsed.success) {
          setError("unavailable");
          return null;
        }
        completed = parsed.data;
        setAck(completed);
      }
      forget(`${key}:operation`);
      setCommand(null);
      setRecovery(null);
      setUncertain(false);
      setCancelBody(null);
      return completed;
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof ProfileApiError ? cause.code : "unavailable");
      return null;
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return {
    command: command ?? recovery,
    ack,
    busy,
    error,
    uncertain,
    cancel,
    run: (payload: C) =>
      command === null && recovery === null ? execute(payload) : Promise.resolve(null),
    retry: () => (command === null ? recover() : execute(command)),
    discard: () => {
      if (!busy && !uncertain) {
        forget(`${key}:operation`);
        setCommand(null);
        setRecovery(null);
        setError(null);
      }
    },
  };
}
const operationSchema = z.object({ requestId: z.uuid(), action: z.string() });
const cancellationSchema = z.union([
  z.object({ status: z.literal("canceled"), operationId: z.uuid() }),
  z.object({ status: z.literal("canceled"), requestId: z.uuid() }),
  z.object({
    status: z.literal("completed"),
    operationId: z.uuid(),
    result: z.unknown().optional(),
  }),
  z.object({ status: z.literal("complete"), data: z.unknown() }),
]);
function isUncertain(cause: unknown): boolean {
  if (!(cause instanceof ProfileApiError)) return true;
  return [
    "unavailable",
    "write_failed",
    "storage_unavailable",
    "provider_unavailable",
    "replay_conflict",
  ].includes(cause.code);
}
