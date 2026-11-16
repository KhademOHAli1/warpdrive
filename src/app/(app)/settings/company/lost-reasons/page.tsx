import type { ReactNode } from "react";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/frontend/context";
import { listLostReasons } from "@/frontend/reads";
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

  const rows = await listLostReasons();
  const serializable = rows.map((r) => ({ id: r.id, name: r.name }));
  return <LostReasonsClient rows={serializable} />;
}
