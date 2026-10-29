import type { ReactNode } from "react";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { getLocalePreferences } from "@/features/i18n/server";
import { listPermissionSets } from "@/features/identity/permission-sets.service";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { formatNumber } from "@/lib/localeFormatting";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../SettingsHeading";
import {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_HEAD,
  SETTINGS_TABLE_HEADER_CELL,
  SETTINGS_TABLE_ROW,
  SettingsCard,
  SettingsPage,
} from "../SettingsSurface";
import { PermissionSetsClient } from "./PermissionSetsClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.permissionSets };
}

export default async function PermissionSetsPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();
  const preferences = await getLocalePreferences();
  const C = L.columns;
  const V = L.values;

  const { actor, db } = await createContext();
  if (actor === null || (actor.type !== "admin" && !actor.flags.has(PERMISSION_FLAGS.MANAGE))) {
    return <p className="text-sm text-red-600">{L.requiresAdmin}</p>;
  }
  const rows = await listPermissionSets(db, AbortSignal.timeout(5000));
  // Serializable projection for the client editor (flags is a plain JSONB object).
  const sets = rows.map((ps) => ({ id: ps.id, name: ps.name, flags: ps.flags }));
  return (
    <SettingsPage>
      <SettingsHeading title={L.permissionSets} description={L.permissionSetsDescription} />
      <SettingsCard className="shadow-none">
        <table className="w-full text-sm">
          <thead className={SETTINGS_TABLE_HEAD}>
            <tr className="border-b">
              <th className={SETTINGS_TABLE_HEADER_CELL}>{C.name}</th>
              <th className={SETTINGS_TABLE_HEADER_CELL}>{C.flagsEnabled}</th>
              <th className={SETTINGS_TABLE_HEADER_CELL}>{C.default}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((ps) => {
              const flagCount = Object.values(ps.flags).filter(Boolean).length;
              return (
                <tr key={ps.id} className={SETTINGS_TABLE_ROW}>
                  <td className={SETTINGS_TABLE_CELL}>{ps.name}</td>
                  <td className={`${SETTINGS_TABLE_CELL} tabular-nums`}>
                    {formatNumber(flagCount, preferences)}
                  </td>
                  <td className={SETTINGS_TABLE_CELL}>{ps.isDefault ? V.yes : V.no}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SettingsCard>
      <PermissionSetsClient sets={sets} />
    </SettingsPage>
  );
}
