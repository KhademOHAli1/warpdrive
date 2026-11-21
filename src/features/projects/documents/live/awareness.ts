import { type Awareness, removeAwarenessStates } from "y-protocols/awareness";
import type { ProjectDocumentPeer } from "./contracts";

const colors = ["#1d4ed8", "#047857", "#7e22ce", "#be123c", "#b45309", "#0e7490"] as const;

export function projectDocumentPeerColor(clientId: number) {
  return colors[clientId % colors.length] ?? colors[0];
}

export function updateProjectDocumentPeers(awareness: Awareness, peers: ProjectDocumentPeer[]) {
  const origin = "project document presence";
  const states = awareness.getStates();
  const remote = peers.filter((peer) => peer.clientId !== awareness.clientID);
  const live = new Set(remote.map(({ clientId }) => clientId));
  const removed = [...states.keys()].filter((id) => id !== awareness.clientID && !live.has(id));
  if (removed.length > 0) removeAwarenessStates(awareness, removed, origin);
  const added: number[] = [];
  const updated: number[] = [];
  const lastUpdated = Date.now();
  for (const peer of remote) {
    const previous = states.get(peer.clientId);
    const next = {
      user: { name: peer.name, color: projectDocumentPeerColor(peer.clientId) },
      cursor: peer.cursor,
    };
    const clock = awareness.meta.get(peer.clientId)?.clock ?? 0;
    awareness.meta.set(peer.clientId, { clock, lastUpdated });
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    states.set(peer.clientId, next);
    (previous === undefined ? added : updated).push(peer.clientId);
  }
  if (added.length > 0 || updated.length > 0) {
    awareness.emit("change", [{ added, updated, removed: [] }, origin]);
    awareness.emit("update", [{ added, updated, removed: [] }, origin]);
  }
}
