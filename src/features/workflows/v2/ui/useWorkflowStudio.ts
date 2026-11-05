"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActionBlockKind,
  BlockOutput,
  WorkflowV2Definition,
  WorkflowV2Document,
  WorkflowV2Studio,
} from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { parseWorkflowV2Draft, validateWorkflowV2 } from "@/features/blocks/validation";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  archiveWorkflowV2Action,
  pauseWorkflowV2Action,
  publishWorkflowV2Action,
  readWorkflowV2StudioAction,
  saveWorkflowV2Action,
  startWorkflowV2Action,
  testWorkflowV2DraftAction,
  unarchiveWorkflowV2Action,
} from "../actions";
import {
  arrangeStudio,
  connectStudioNodes,
  freshId,
  initialConfig,
  portsForNode,
  removeStudioNode,
} from "./studioModel";

type Simulation = Extract<
  Awaited<ReturnType<typeof testWorkflowV2DraftAction>>,
  { ok: true }
>["value"];
type Command = "save" | "publish" | "pause" | "archive" | "restore";
function stamp(document: WorkflowV2Document) {
  return JSON.stringify({ name: document.name, definition: document.draft });
}
export function useWorkflowStudio(initial: WorkflowV2Document) {
  const L = useSharedBlocksMessages();
  const [document, setDocument] = useState(initial);
  const [saved, setSaved] = useState(() => stamp(initial));
  const [studio, setStudio] = useState<WorkflowV2Studio | null>(null);
  const [metadataError, setMetadataError] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState("$trigger");
  const [tab, setTab] = useState<"configure" | "palette" | "runs" | "test">("configure");
  const [past, setPast] = useState<WorkflowV2Definition[]>([]);
  const [future, setFuture] = useState<WorkflowV2Definition[]>([]);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [reveal, setReveal] = useState<{ id: string; nonce: number }>();
  const revealNonce = useRef(0);
  const [simulation, setSimulation] = useState<{ stamp: string; value: Simulation } | null>(null);
  const [runId, setRunId] = useState<string>();
  const lock = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current += 1;
    };
  }, []);
  const dirty = stamp(document) !== saved;
  const archived = document.archivedAt !== null;
  const capabilities = document.capabilities ??
    initial.capabilities ?? { edit: false, publish: false, run: false, archive: false };
  const disabled = pending || archived || !capabilities.edit;
  const manualLaunch =
    !archived &&
    document.active &&
    capabilities.run &&
    document.publishedNumber !== null &&
    document.publishedManualLaunch !== undefined
      ? { ...document.publishedManualLaunch, version: document.publishedNumber }
      : null;
  function failure(id: string) {
    if (!alive.current) return;
    setError(
      id.endsWith("CONFLICT")
        ? L.conflict
        : id.endsWith("DENIED")
          ? L.denied
          : id.endsWith("NOT_READY")
            ? L.notReady
            : L.failed,
    );
  }
  const loadStudio = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await readWorkflowV2StudioAction();
      if (!alive.current || request !== generation.current) return;
      if (result.ok) {
        setStudio(result.value);
        setMetadataError(false);
      } else setMetadataError(true);
    } catch {
      if (alive.current && request === generation.current) setMetadataError(true);
    }
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => (active ? loadStudio() : undefined));
    return () => {
      active = false;
    };
  }, [loadStudio]);
  function accept(next: WorkflowV2Document) {
    setDocument(next);
    setSaved(stamp(next));
  }
  function edit(next: WorkflowV2Definition) {
    if (lock.current || disabled) return;
    setPast((history) => [...history, document.draft].slice(-40));
    setFuture([]);
    setDocument((current) => ({ ...current, draft: next }));
    setError(null);
    setNotice(null);
  }
  function select(id: string, revealNode = false) {
    setSelected(id);
    setReveal(revealNode ? { id, nonce: ++revealNonce.current } : undefined);
  }
  function add(type: ActionBlockKind, port?: string) {
    if (document.draft.nodes.length >= 100) {
      setError(L.invalid);
      return;
    }
    const id = freshId();
    const node = {
      id,
      type,
      version: 1 as const,
      name: L.blocks[type] ?? type,
      config: initialConfig(type),
    };
    let draft = { ...document.draft, nodes: [...document.draft.nodes, node] };
    if (selected === "$trigger") draft = connectStudioNodes(draft, "$trigger", id, "next") ?? draft;
    else {
      const source = draft.nodes.find((item) => item.id === selected);
      if (source !== undefined)
        draft =
          connectStudioNodes(draft, selected, id, port ?? portsForNode(source)[0] ?? "next") ??
          draft;
    }
    edit(arrangeStudio(draft));
    select(id);
    setTab("configure");
    setLayoutRevision((value) => value + 1);
  }
  function undo(direction: "undo" | "redo") {
    if (disabled || lock.current) return;
    const next = direction === "undo" ? past.at(-1) : future[0];
    if (next === undefined) return;
    if (direction === "undo") {
      setPast(past.slice(0, -1));
      setFuture([document.draft, ...future]);
    } else {
      setPast([...past, document.draft]);
      setFuture(future.slice(1));
    }
    setDocument((current) => ({ ...current, draft: next }));
    setLayoutRevision((value) => value + 1);
  }
  function check(executable = true) {
    const result = executable
      ? validateWorkflowV2(document.draft)
      : parseWorkflowV2Draft(document.draft);
    if (!result.ok || document.name.trim() === "") {
      setError(result.ok ? L.invalid : (L.validation[result.error] ?? L.invalid));
      return false;
    }
    return true;
  }
  async function persist() {
    if (!dirty) return document;
    const result = await saveWorkflowV2Action(
      {
        id: document.id,
        expectedRevision: document.revision,
        name: document.name,
        definition: document.draft,
      },
      readCsrfToken(),
    );
    if (!alive.current) return null;
    if (!result.ok) {
      failure(result.error.id);
      return null;
    }
    accept(result.value);
    return result.value;
  }
  async function publish(current: WorkflowV2Document) {
    const result = await publishWorkflowV2Action(
      { id: current.id, expectedRevision: current.revision },
      readCsrfToken(),
    );
    if (!alive.current) return;
    if (!result.ok) {
      failure(result.error.id);
      return;
    }
    accept(result.value.document);
    setNotice(L.published);
  }
  async function lifecycle(current: WorkflowV2Document, command: "pause" | "archive" | "restore") {
    const action =
      command === "pause"
        ? pauseWorkflowV2Action
        : command === "archive"
          ? archiveWorkflowV2Action
          : unarchiveWorkflowV2Action;
    const result = await action(
      { id: current.id, expectedRevision: current.revision },
      readCsrfToken(),
    );
    if (!alive.current) return;
    if (!result.ok) {
      failure(result.error.id);
      return;
    }
    accept(result.value);
    setNotice(command === "pause" ? L.paused : command === "archive" ? L.archived : L.restore);
  }
  async function command(command: Command) {
    const allowed =
      command === "publish"
        ? capabilities.publish
        : command === "archive" || command === "restore"
          ? capabilities.archive
          : capabilities.edit;
    if (
      lock.current ||
      !allowed ||
      (archived && command !== "restore") ||
      !check(command === "publish")
    )
      return;
    lock.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const current = await persist();
      if (current === null || !alive.current) return;
      if (command === "save") {
        setNotice(L.saved);
        return;
      }
      if (command === "publish") {
        await publish(current);
        return;
      }
      await lifecycle(current, command);
    } catch {
      failure("FAILED");
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }
  async function test(trigger: BlockOutput = {}) {
    if (lock.current || pending || archived || !capabilities.run || !check()) return;
    lock.current = true;
    setPending(true);
    setError(null);
    setTab("test");
    const snapshot = stamp(document);
    try {
      const result = await testWorkflowV2DraftAction(
        { definition: document.draft, trigger },
        readCsrfToken(),
      );
      if (!alive.current) return;
      if (result.ok) setSimulation({ stamp: snapshot, value: result.value });
      else failure(result.error.id);
    } catch {
      failure("FAILED");
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }
  async function live(trigger: BlockOutput, requestKey: string, expectedPublishedNumber: number) {
    if (lock.current || pending || manualLaunch === null) return false;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await startWorkflowV2Action(
        { id: document.id, requestKey, mode: "live", trigger, expectedPublishedNumber },
        readCsrfToken(),
      );
      if (!alive.current) return false;
      if (!result.ok) {
        failure(result.error.id);
        return false;
      }
      setRunId(result.value.id);
      setTab("runs");
      return true;
    } catch {
      failure("FAILED");
      return false;
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }
  return {
    L,
    document,
    studio,
    metadataError,
    loadStudio,
    dirty,
    disabled,
    pending,
    error,
    notice,
    archived,
    capabilities,
    selected,
    select,
    tab,
    setTab,
    edit,
    add,
    undo,
    past,
    future,
    layoutRevision,
    reveal,
    command,
    test,
    manualLaunch,
    live,
    runId,
    simulation: simulation?.stamp === stamp(document) ? simulation.value : null,
    accept,
    name: (name: string) => {
      if (!lock.current && !disabled) setDocument((current) => ({ ...current, name }));
    },
    arrange: () => {
      edit(arrangeStudio(document.draft));
      setReveal(undefined);
      setLayoutRevision((value) => value + 1);
    },
    remove: () => {
      edit(removeStudioNode(document.draft, selected));
      select("$trigger");
    },
  };
}
export type WorkflowStudioModel = ReturnType<typeof useWorkflowStudio>;
