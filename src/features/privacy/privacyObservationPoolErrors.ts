import { errorMonitor } from "node:events";
import type { Pool, PoolClient } from "pg";

type ClientFailure = () => void;
type PoolOwnership = {
  clients: Map<PoolClient, ClientFailure>;
  sinks: Set<() => void>;
  listener: (error: Error, client: PoolClient) => void;
};
const ownedPools = new WeakMap<Pool, PoolOwnership>();

export function ownPrivacyObservationPoolErrors(
  pool: Pool,
  client: PoolClient,
  failed: ClientFailure,
): () => void {
  let ownership = ownedPools.get(pool);
  if (ownership === undefined) {
    const clients = new Map<PoolClient, ClientFailure>();
    const sinks = new Set<() => void>();
    const listener = (_error: Error, broken: PoolClient) => {
      const owner = clients.get(broken);
      if (owner === undefined) {
        // Do not suppress a foreign event, including one emitted reentrantly by an external handler.
        for (const sink of sinks) pool.removeListener("error", sink);
        sinks.clear();
        return;
      }
      const sink = () => {
        sinks.delete(sink);
      };
      sinks.add(sink);
      pool.prependOnceListener("error", sink);
      owner();
    };
    ownership = { clients, sinks, listener };
    ownedPools.set(pool, ownership);
    pool.addListener(errorMonitor, listener);
  }
  const selected = ownership;
  selected.clients.set(client, failed);
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    selected.clients.delete(client);
    if (selected.clients.size === 0) {
      pool.removeListener(errorMonitor, selected.listener);
      for (const sink of selected.sinks) pool.removeListener("error", sink);
      selected.sinks.clear();
      if (ownedPools.get(pool) === selected) ownedPools.delete(pool);
    }
  };
}
