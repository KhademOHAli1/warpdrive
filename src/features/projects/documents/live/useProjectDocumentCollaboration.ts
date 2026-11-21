"use client";

import { TRPCClientError } from "@trpc/client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ProjectFailure } from "../../contracts";
import { updateProjectDocumentPeers } from "./awareness";
import type {
  ProjectDocumentCollaboration,
  ProjectDocumentCollaborationInput,
  ProjectDocumentPeer,
  ProjectDocumentPresence,
} from "./contracts";
import { projectDocumentCursorInput } from "./presenceInput";

const remoteUpdate = Symbol("project document collaboration");
const pollInterval = 1_000;
const sendDelay = 150;
const retryInterval = 2_500;
const presenceInterval = 4_000;

function encode(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function decode(bytes: string) {
  return Uint8Array.from(atob(bytes), (value) => value.charCodeAt(0));
}

function requestErrorCode(error: unknown) {
  const data: unknown = error instanceof TRPCClientError ? error.data : undefined;
  return typeof data === "object" && data !== null && "code" in data ? data.code : undefined;
}

function peersChanged(previous: ProjectDocumentPeer[], next: ProjectDocumentPeer[]) {
  const identities = (peers: ProjectDocumentPeer[]) =>
    JSON.stringify(peers.map(({ clientId, name }) => [clientId, name]));
  return identities(previous) !== identities(next);
}

type CollaborationSession = {
  shared: Y.Doc | null;
  awareness: Awareness | null;
  snapshot: ProjectDocumentCollaboration;
};

type CollaborationStatus = "connecting" | "current" | "syncing" | "offline" | "rejected" | "denied";

export function useProjectDocumentCollaboration(
  projectId: string,
  documentId: string,
  enabled: boolean,
) {
  const { mutateAsync } = trpc.projectDocuments.collaborate.useMutation({
    gcTime: 0,
    retry: false,
  });
  const exchange = useEffectEvent((input: ProjectDocumentCollaborationInput) =>
    mutateAsync({ ...input, csrfToken: readCsrfToken() }),
  );
  const [session, setSession] = useState<CollaborationSession | null>(null);
  const [status, setStatus] = useState<CollaborationStatus>("connecting");
  const [hasUnsentChanges, setHasUnsentChanges] = useState(false);
  const discard = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let waiting = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let snapshot: ProjectDocumentCollaboration | null = null;
    let shared: Y.Doc | null = null;
    let awareness: Awareness | null = null;
    let lastPresence: { cursor: string; time: number } | null = null;
    let departure: ProjectDocumentCollaborationInput | null = null;
    let updates: Uint8Array[] = [];
    let rejected = false;
    let resetRequested = false;

    // Start each handshake with canonical state. No live bytes are retained across tabs.
    function discardShared() {
      shared?.destroy();
      shared = null;
      awareness = null;
      lastPresence = null;
      updates = [];
      setHasUnsentChanges(false);
    }

    function schedule(delay: number) {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(() => void synchronize(), delay);
    }

    function onUpdate(update: Uint8Array, origin: unknown) {
      if (origin === remoteUpdate) return;
      updates.push(update);
      rejected = false;
      setHasUnsentChanges(true);
      setStatus("syncing");
      if (!waiting && updates.length === 1) schedule(sendDelay);
    }

    function restartHandshake() {
      discardShared();
      snapshot = null;
      rejected = false;
      setSession(null);
      setStatus("connecting");
    }

    function accept(next: ProjectDocumentCollaboration, sent: number) {
      const changedEpoch = snapshot?.epoch !== next.epoch;
      if (changedEpoch || !next.live) discardShared();
      else if (sent > 0) {
        updates = updates.slice(sent);
        setHasUnsentChanges(updates.length > 0);
      }
      if (next.live && shared === null) {
        shared = new Y.Doc();
        awareness = new Awareness(shared);
        shared.on("update", onUpdate);
      }
      if (shared !== null && next.update !== null)
        Y.applyUpdate(shared, decode(next.update), remoteUpdate);
      if (awareness !== null) updateProjectDocumentPeers(awareness, next.peers);
      if (changedEpoch) rejected = false;
      const previous = snapshot;
      snapshot = next;
      if (
        changedEpoch ||
        previous === null ||
        previous.document.revision !== next.document.revision ||
        previous.canEdit !== next.canEdit ||
        previous.canManage !== next.canManage ||
        previous.live !== next.live ||
        peersChanged(previous.peers, next.peers)
      )
        setSession({ shared, awareness, snapshot: next });
      setStatus(rejected ? "rejected" : updates.length > 0 ? "syncing" : "current");
    }

    function rejectUpdate() {
      rejected = true;
      setStatus("rejected");
      return pollInterval;
    }

    function retryConnection() {
      if (awareness !== null) updateProjectDocumentPeers(awareness, []);
      setStatus("offline");
      return retryInterval;
    }

    function failSync(error: ProjectFailure, sent: number) {
      if (error === "project_forbidden" && sent > 0) {
        restartHandshake();
        return sendDelay;
      }
      if (error === "project_invalid" && sent > 0) return rejectUpdate();
      if (error === "project_unavailable" || error === "project_forbidden") {
        deny();
        return pollInterval;
      }
      return retryConnection();
    }

    function failRequest(error: unknown, sent: number) {
      const code = requestErrorCode(error);
      if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
        deny();
        return pollInterval;
      }
      if (code === "BAD_REQUEST" && sent > 0) return rejectUpdate();
      return retryConnection();
    }

    function currentPresence(): ProjectDocumentPresence | null {
      if (awareness === null) return null;
      const localCursor: unknown = awareness.getLocalState()?.cursor;
      const parsed = projectDocumentCursorInput.safeParse(localCursor);
      const cursor = parsed.success ? parsed.data : null;
      if (
        lastPresence?.cursor === JSON.stringify(cursor) &&
        Date.now() - lastPresence.time < presenceInterval
      )
        return null;
      return { clientId: awareness.clientID, cursor };
    }

    function leave() {
      if (departure !== null) {
        void exchange(departure).catch(() => undefined);
        departure = null;
      }
    }

    function acceptExchange(
      next: ProjectDocumentCollaboration,
      sent: number,
      presence: ProjectDocumentPresence | null,
      epoch: number | null,
    ) {
      accept(next, sent);
      if (presence !== null && next.epoch === epoch)
        lastPresence = { cursor: JSON.stringify(presence.cursor), time: Date.now() };
      return updates.length > 0 && !rejected ? sendDelay : pollInterval;
    }

    function finishRound(delay: number) {
      waiting = false;
      if (stopped) leave();
      else schedule(resetRequested ? 0 : delay);
      resetRequested = false;
    }

    async function synchronize() {
      waiting = true;
      let delay = pollInterval;
      const sent = rejected ? 0 : updates.length;
      const handshake = snapshot === null || (!snapshot.live && snapshot.canEdit);
      const presence = currentPresence();
      const epoch = snapshot?.epoch ?? null;
      try {
        const result = await exchange({
          projectId,
          documentId,
          epoch: handshake ? null : epoch,
          revision: snapshot?.document.revision ?? null,
          stateVector: shared === null ? null : encode(Y.encodeStateVector(shared)),
          update: sent === 0 ? null : encode(Y.mergeUpdates(updates.slice(0, sent))),
          presence,
        });
        if (stopped || resetRequested) return;
        delay = result.ok
          ? acceptExchange(result.value, sent, presence, epoch)
          : failSync(result.error, sent);
      } catch (error) {
        if (stopped || resetRequested) return;
        delay = failRequest(error, sent);
      } finally {
        finishRound(delay);
      }
    }

    function deny() {
      clearTimeout(timer);
      stopped = true;
      discardShared();
      setSession(null);
      setStatus("denied");
    }

    discard.current = () => {
      restartHandshake();
      if (waiting) resetRequested = true;
      else schedule(0);
    };
    schedule(0);
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (awareness !== null && snapshot !== null && lastPresence !== null) {
        departure = {
          projectId,
          documentId,
          epoch: snapshot.epoch,
          revision: snapshot.document.revision,
          stateVector: shared === null ? null : encode(Y.encodeStateVector(shared)),
          update: null,
          presence: { clientId: awareness.clientID, cursor: null, leave: true },
        };
        if (!waiting) leave();
      }
      shared?.destroy();
      discard.current = null;
    };
  }, [projectId, documentId, enabled]);

  return {
    session,
    status,
    hasUnsentChanges,
    discardUnsentChanges: () => discard.current?.(),
  };
}
