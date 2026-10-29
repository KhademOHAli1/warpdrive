import type { ReactNode } from "react";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { db } from "@/db/client";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { listLostReasons } from "@/features/settings/lostReasonsRepo";
import { createContext } from "@/server/trpc/context";
import { LostReasonsClient } from "./LostReasonsClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.lostReasons };
}

// Company settings > Lost reasons tab (spec 6.3): catalog list + add + rename + reorder + archive.
export default async function LostReasonsPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const { actor } = await createContext();
  if (actor === null || (actor.type !== "admin" && !actor.flags.has(PERMISSION_FLAGS.MANAGE))) {
    return <p className="text-sm text-red-600">{L.requiresAdmin}</p>;
  }

  const rows = await listLostReasons(db, AbortSignal.timeout(5000));
  const serializable = rows.map((r) => ({ id: r.id, name: r.name }));
  return <LostReasonsClient rows={serializable} />;
}
