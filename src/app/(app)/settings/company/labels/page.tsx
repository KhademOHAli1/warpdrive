import type { ReactNode } from "react";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/frontend/context";
import { listLabels } from "@/frontend/reads";
import { LabelsClient } from "./LabelsClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.labels };
}

// Company settings > Labels tab (spec 6.4): labels grouped by target with an enum color picker.
export default async function LabelsPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const { actor } = await createContext();
  if (actor === null || (actor.type !== "admin" && !actor.flags.has(PERMISSION_FLAGS.MANAGE))) {
    return <p className="text-sm text-red-600">{L.requiresAdmin}</p>;
  }

  const rows = await listLabels();
  const serializable = rows.map((l) => ({
    id: l.id,
    target: l.target,
    name: l.name,
    color: l.color,
  }));
  return <LabelsClient rows={serializable} />;
}
