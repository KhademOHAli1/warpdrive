"use client";

import { useEffect, useRef, useState } from "react";
import type { AssetMediaAccess, AssetMediaResult, AssetMediaTarget } from "../contracts";

type FileKind = Parameters<AssetMediaAccess["upload"]>[0]["kind"];
type ErrorCode = Extract<AssetMediaResult, { ok: false }>["error"] | "transport";
type Outcome = AssetMediaResult | { ok: false; error: "transport" };
type Operation =
  | { type: "upload"; file: File; kind: FileKind }
  | { type: "cover"; fileId: string | null };
type Attempt = { operation: Operation; requestId: string; version: number };
type Loaded = { access: AssetMediaAccess; scope: string; result: Outcome };

function sameOperation(left: Operation, right: Operation) {
  if (left.type === "upload") {
    return right.type === "upload" && left.file === right.file && left.kind === right.kind;
  }
  return right.type === "cover" && left.fileId === right.fileId;
}

export function useAssetMedia(
  access: AssetMediaAccess | undefined,
  target: AssetMediaTarget,
  targetContext: string,
) {
  const { type, id } = target;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const scope = `${type}:${id}:${targetContext}:${reloadKey}`;
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const retry = useRef<Attempt | null>(null);
  const flight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (access === undefined) return;
    let relevant = true;
    const accept = (result: Outcome) => {
      if (!relevant) return;
      setLoaded((previous) => {
        if (
          previous?.access === access &&
          previous.scope === scope &&
          previous.result.ok &&
          result.ok &&
          previous.result.value.version > result.value.version
        )
          return previous;
        return { access, scope, result };
      });
    };
    void access.read({ type, id }).then(accept, () => accept({ ok: false, error: "transport" }));
    return () => {
      relevant = false;
    };
  }, [access, type, id, scope]);

  const result = loaded?.scope === scope && loaded.access === access ? loaded.result : null;
  const workspace = result?.ok === true ? result.value : null;

  async function commit(operation: Operation) {
    if (access === undefined || workspace?.canManage !== true || flight.current) return false;
    flight.current = true;
    const version = workspace.version;
    const last = retry.current;
    const requestId =
      last?.version === version && sameOperation(last.operation, operation)
        ? last.requestId
        : crypto.randomUUID();
    retry.current = { operation, version, requestId };
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const next =
        operation.type === "upload"
          ? await access.upload({
              target,
              version,
              requestId,
              file: operation.file,
              kind: operation.kind,
            })
          : await access.setCover({ target, version, requestId, fileId: operation.fileId });
      if (!mounted.current) return false;
      retry.current = null;
      if (!next.ok) {
        if (next.error === "unavailable") {
          setLoaded((previous) =>
            previous?.scope === scope && previous.access === access
              ? { access, scope, result: next }
              : previous,
          );
        } else {
          setError(next.error);
        }
        return false;
      }
      setLoaded((previous) => {
        if (previous !== null && (previous.access !== access || previous.scope !== scope))
          return previous;
        if (previous?.result.ok === true && previous.result.value.version > next.value.version)
          return previous;
        return { access, scope, result: next };
      });
      setSaved(true);
      return true;
    } catch {
      if (mounted.current) setError("transport");
      return false;
    } finally {
      flight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return {
    available: access !== undefined,
    workspace,
    error,
    pending,
    saved,
    loading: result === null,
    readError: result?.ok === false ? result.error : null,
    clearStatus: () => {
      setError(null);
      setSaved(false);
    },
    reload: () => setReloadKey((value) => value + 1),
    upload: (kind: FileKind, file: File) => commit({ type: "upload", kind, file }),
    setCover: (fileId: string | null) => commit({ type: "cover", fileId }),
  };
}

export type AssetMediaController = ReturnType<typeof useAssetMedia>;
