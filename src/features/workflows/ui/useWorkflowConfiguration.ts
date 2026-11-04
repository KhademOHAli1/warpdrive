"use client";

import { useRef, useState } from "react";
import { z } from "zod";
import { type RouterOutputs, trpc } from "@/lib/trpc-client";
import type { ConfigurationMetadata } from "../configurationTypes";
import { findPaletteEntry } from "../paletteCatalog";
import type { WorkflowNode } from "../schemas";
import {
  buildConfigurationMetadata,
  type ConfigurationContinuation,
  type ConfigurationOptionsPage,
  type ConfigurationPage,
} from "./configurationMetadataView";
import { libraryReadDenied } from "./libraryErrors";

export interface WorkflowConfigurationRead {
  metadata: ConfigurationMetadata;
  authoring?: boolean;
  busy: boolean;
  loadMore: (() => Promise<void>) | undefined;
  retry: () => Promise<void>;
}
type ReadResponse = RouterOutputs["workflows"]["configuration"];
type OptionsResponse = RouterOutputs["workflows"]["configurationOptions"];
interface Profile {
  id: string;
  type: unknown;
  version: unknown;
}
interface Frame {
  scope: string;
  generation: object;
  first?: ConfigurationPage;
  receipt: number;
  fields: ConfigurationContinuation<ConfigurationPage>[];
  options: ConfigurationContinuation<ConfigurationOptionsPage>[];
  failure?: "error" | "stale" | "denied";
  busy: boolean;
}
interface Flight {
  generation: object;
}
type Continuation =
  | { kind: "fields"; cursor: string; page: ReadResponse }
  | { kind: "options"; fieldId: string; cursor: string | undefined; page: OptionsResponse };

function currentPage(
  data: ReadResponse | undefined,
  profile: Profile,
): ConfigurationPage | undefined {
  if (data?.state !== "page") return undefined;
  return data.workflowId === profile.id &&
    data.type === profile.type &&
    data.version === profile.version
    ? data
    : undefined;
}
function empty(scope: string, first?: ConfigurationPage, receipt = 0): Frame {
  return { scope, generation: {}, first, receipt, fields: [], options: [], busy: false };
}
function adoptFirst(frame: Frame, first: ConfigurationPage, receipt: number): Frame {
  const restart = frame.failure === "denied" || frame.failure === "stale";
  return {
    ...frame,
    generation: {},
    first,
    receipt,
    failure: undefined,
    busy: false,
    fields: restart ? [] : frame.fields,
    options: restart ? [] : frame.options,
  };
}
function currentFrame(
  frame: Frame,
  scope: string,
  first: ConfigurationPage | undefined,
  receipt: number,
  positive: boolean,
): Frame {
  if (frame.scope !== scope) return empty(scope, first, receipt);
  if (first === undefined) return frame;
  if (frame.first?.fingerprint !== first.fingerprint)
    return { ...empty(scope, first, receipt), failure: positive ? undefined : frame.failure };
  return positive && receipt !== frame.receipt ? adoptFirst(frame, first, receipt) : frame;
}
function samePage(first: ConfigurationPage, page: ConfigurationPage | ConfigurationOptionsPage) {
  const expected = findPaletteEntry(first.type, first.version);
  return (
    expected !== undefined &&
    first.workflowId === page.workflowId &&
    first.type === page.type &&
    expected === findPaletteEntry(page.type, page.version) &&
    first.fingerprint === page.fingerprint
  );
}
function continuationResult(frame: Frame, generation: object, result: Continuation): Frame {
  if (frame.generation !== generation || frame.first === undefined) return frame;
  if (frame.failure === "denied") return frame;
  const page = result.page;
  if (page.state === "stale") return { ...frame, failure: "stale" };
  if (!samePage(frame.first, page)) return { ...frame, failure: "stale" };
  if (result.kind === "fields" && result.page.state === "page")
    return {
      ...frame,
      failure: undefined,
      fields: [...frame.fields, { cursor: result.cursor, page: result.page }],
    };
  if (result.kind !== "options" || result.page.state !== "page") return frame;
  if (result.page.fieldId !== result.fieldId || result.page.query !== "")
    return { ...frame, failure: "stale" };
  return {
    ...frame,
    failure: undefined,
    options: [...frame.options, { cursor: result.cursor, page: result.page }],
  };
}
function failure(error: unknown): "denied" | "error" {
  return libraryReadDenied(error) ? "denied" : "error";
}

function metadataState(
  frame: Frame,
  enabled: boolean,
  denied: boolean,
  query: {
    isError: boolean;
    isLoading: boolean;
    isFetching: boolean;
    data: ReadResponse | undefined;
  },
  view: ReturnType<typeof buildConfigurationMetadata> | undefined,
): ConfigurationMetadata {
  if (denied) return { status: "denied" };
  if (!enabled) return { status: "incomplete" };
  if (query.data?.state === "stale" || frame.failure === "stale")
    return { status: "stale", defs: view?.metadata.defs };
  if (query.isError || frame.failure === "error")
    return { status: "error", defs: view?.metadata.defs };
  if (query.isLoading || query.isFetching || view === undefined)
    return { status: "loading", defs: view?.metadata.defs };
  return view.metadata;
}

export function useWorkflowConfiguration(
  workflowId: string | undefined,
  node: WorkflowNode,
): WorkflowConfigurationRead {
  const id = workflowId ?? "";
  const scope = `${id}:${node.type}:${node.version}`;
  const profile: Profile = { id, type: node.type, version: node.version };
  const enabled =
    z.string().uuid().safeParse(id).success &&
    findPaletteEntry(node.type, node.version) !== undefined;
  const query = trpc.workflows.configuration.useQuery(
    { workflowId: id, type: node.type, version: node.version },
    { enabled, refetchOnMount: "always", staleTime: 0 },
  );
  const utils = trpc.useUtils();
  const first = currentPage(query.data, profile);
  const positive = !query.isError && !query.isLoading && !query.isFetching;
  const [saved, setSaved] = useState<Frame>(() => empty(scope, first, query.dataUpdatedAt));
  const observed = currentFrame(saved, scope, first, query.dataUpdatedAt, positive);
  const queryDenied = query.isError && libraryReadDenied(query.error);
  const frame =
    queryDenied && observed.failure !== "denied"
      ? { ...observed, failure: "denied" as const }
      : observed;
  // A scope/fingerprint transition owns a distinct generation, including A -> B -> A.
  // Same-fiber guarded state preserves this identity without effect synchronization.
  if (frame !== saved) setSaved(frame);
  const active = useRef<Flight | null>(null);
  const view =
    frame.first === undefined
      ? undefined
      : buildConfigurationMetadata(frame.first, frame.fields, frame.options);
  const denied = queryDenied || frame.failure === "denied";

  function begin(): Flight | undefined {
    if (active.current?.generation === frame.generation) return undefined;
    const flight = { generation: frame.generation };
    active.current = flight;
    setSaved((previous) =>
      previous.generation === flight.generation ? { ...previous, busy: true } : previous,
    );
    return flight;
  }
  function finish(flight: Flight) {
    if (active.current !== flight) return;
    active.current = null;
    setSaved((previous) =>
      previous.generation === flight.generation ? { ...previous, busy: false } : previous,
    );
  }
  function fail(flight: Flight, error: unknown) {
    setSaved((previous) =>
      previous.generation === flight.generation
        ? { ...previous, failure: previous.failure === "denied" ? "denied" : failure(error) }
        : previous,
    );
  }
  async function retry(): Promise<void> {
    if (!enabled) return;
    const flight = begin();
    if (flight === undefined) return;
    // A confirmed denial stays latched through the request; cached data is not authority.
    try {
      const result = await query.refetch();
      if (result.isError) {
        fail(flight, result.error);
        return;
      }
      const confirmed = currentPage(result.data, profile);
      setSaved((previous) => {
        if (previous.generation !== flight.generation) return previous;
        if (confirmed === undefined)
          return {
            ...previous,
            failure:
              previous.failure === "denied"
                ? "denied"
                : result.data?.state === "stale"
                  ? "stale"
                  : "error",
          };
        const base =
          previous.first?.fingerprint === confirmed.fingerprint
            ? previous
            : empty(scope, confirmed, result.dataUpdatedAt);
        return adoptFirst(base, confirmed, result.dataUpdatedAt);
      });
    } catch (error) {
      fail(flight, error);
    } finally {
      finish(flight);
    }
  }
  async function loadMore(): Promise<void> {
    const next = view?.next;
    if (!enabled || frame.first === undefined || next == null || denied) return;
    const flight = begin();
    if (flight === undefined) return;
    const fingerprint = frame.first.fingerprint;
    try {
      if (next.kind === "fields") {
        const page = await utils.workflows.configuration.fetch({
          workflowId: id,
          type: node.type,
          version: node.version,
          fingerprint,
          cursor: next.cursor,
        });
        setSaved((previous) =>
          continuationResult(previous, flight.generation, {
            kind: "fields",
            cursor: next.cursor,
            page,
          }),
        );
      } else {
        const page = await utils.workflows.configurationOptions.fetch({
          workflowId: id,
          type: node.type,
          version: node.version,
          fingerprint,
          fieldId: next.fieldId,
          cursor: next.cursor,
        });
        setSaved((previous) =>
          continuationResult(previous, flight.generation, {
            kind: "options",
            fieldId: next.fieldId,
            cursor: next.cursor,
            page,
          }),
        );
      }
    } catch (error) {
      fail(flight, error);
    } finally {
      finish(flight);
    }
  }
  return {
    metadata: metadataState(frame, enabled, denied, query, view),
    authoring: denied ? false : frame.first?.capabilities.edit,
    busy: frame.busy,
    loadMore: view?.next == null || denied ? undefined : loadMore,
    retry,
  };
}
