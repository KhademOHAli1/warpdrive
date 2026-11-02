"use client";
import { UsersRound } from "lucide-react";
import Link from "next/link";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_HEAD,
  SETTINGS_TABLE_HEADER_CELL,
  SETTINGS_TABLE_ROW,
  SettingsCard,
} from "../SettingsSurface";

interface Team {
  id: string;
  name: string;
  managerId: string | null;
}

interface User {
  id: string;
  name: string;
}

interface Props {
  teams: Team[];
  users: User[];
}

// Pure, synchronous render of the teams table. Resolves each team's managerId to the
// user's display name so the cell never shows a raw UUID.
export function TeamsTable({ teams, users }: Props): React.ReactElement {
  const L = useSettingsMessages();
  const C = L.columns;
  const V = L.values;

  const nameById = new Map(users.map((u) => [u.id, u.name]));
  if (teams.length === 0)
    return (
      <SettingsCard className="space-y-3 p-5">
        <UsersRound className="size-6 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">{L._identity.teamEditor.emptyTitle}</h2>
        <p className="text-sm text-muted-foreground">{L._identity.teamEditor.emptyDescription}</p>
      </SettingsCard>
    );
  return (
    <SettingsCard className="shadow-none">
      <table className="w-full table-fixed text-sm">
        <thead className={SETTINGS_TABLE_HEAD}>
          <tr className="border-b">
            <th className={`${SETTINGS_TABLE_HEADER_CELL} w-2/3`}>{C.name}</th>
            <th className={SETTINGS_TABLE_HEADER_CELL}>{C.manager}</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => (
            <tr key={t.id} className={SETTINGS_TABLE_ROW}>
              <td className={`${SETTINGS_TABLE_CELL} break-words`}>
                {/* Row opens the team's edit page (rename, change manager, edit members). */}
                <Link
                  href={`/settings/teams/${t.id}`}
                  className="block min-h-10 content-center break-words font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {t.name}
                </Link>
              </td>
              <td className={`${SETTINGS_TABLE_CELL} break-words text-muted-foreground`}>
                {t.managerId === null ? V.none : (nameById.get(t.managerId) ?? V.none)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </SettingsCard>
  );
}
