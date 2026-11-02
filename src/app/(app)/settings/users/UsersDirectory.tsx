"use client";

import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_HEAD,
  SETTINGS_TABLE_HEADER_CELL,
  SETTINGS_TABLE_ROW,
  SettingsCard,
} from "../SettingsSurface";
import type { PermissionSetOption, UserRow } from "./types";
import { UserRowControls } from "./UserRowControls";
import { userStatus } from "./userStatus";

export function UsersDirectory({
  rows,
  permissionSets,
  viewerIsAdmin,
  onChanged,
}: {
  rows: UserRow[];
  permissionSets: PermissionSetOption[];
  viewerIsAdmin: boolean;
  onChanged: () => void;
}): React.ReactElement {
  const L = useSettingsMessages();
  const T = L._extra;
  const setNames = new Map(permissionSets.map((set) => [set.id, set.name]));
  const detailColumn = "hidden md:table-cell";

  return (
    <SettingsCard className="shadow-none">
      <div className="overflow-x-auto">
        <table className="w-full text-sm md:min-w-[640px]">
          <thead className={SETTINGS_TABLE_HEAD}>
            <tr className="border-b">
              <th className={SETTINGS_TABLE_HEADER_CELL}>{T.name}</th>
              <th className={`${SETTINGS_TABLE_HEADER_CELL} ${detailColumn}`}>{T.email}</th>
              <th className={`${SETTINGS_TABLE_HEADER_CELL} ${detailColumn}`}>{T.role}</th>
              <th className={`${SETTINGS_TABLE_HEADER_CELL} ${detailColumn}`}>
                {T.permission_set}
              </th>
              <th className={`${SETTINGS_TABLE_HEADER_CELL} ${detailColumn}`}>{T.active}</th>
              <th className={`${SETTINGS_TABLE_HEADER_CELL} w-12`}>{T.actions}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  <p role="status">{L._hierarchy.peopleSearchEmpty}</p>
                </td>
              </tr>
            )}
            {rows.map((person) => {
              const permissionSet =
                person.permissionSetId === null
                  ? T.none
                  : (setNames.get(person.permissionSetId) ?? T.none);
              return (
                <tr key={person.id} className={SETTINGS_TABLE_ROW}>
                  <td className={`${SETTINGS_TABLE_CELL} min-w-0 align-top`}>
                    <span className="break-words font-medium">{person.name}</span>
                    {person.invitedAt !== null && (
                      <span className="ms-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {T.invited}
                      </span>
                    )}
                    <div className="mt-1 space-y-1 md:hidden">
                      <bdi dir="ltr" className="block break-all text-xs text-muted-foreground">
                        {person.email}
                      </bdi>
                      <p className="text-xs text-muted-foreground">
                        {T[userStatus(person)]} · {person.isAdmin ? T.admin : T.regular} ·{" "}
                        {permissionSet}
                      </p>
                    </div>
                  </td>
                  <td className={`${SETTINGS_TABLE_CELL} ${detailColumn} text-muted-foreground`}>
                    <bdi dir="ltr" className="break-all">
                      {person.email}
                    </bdi>
                  </td>
                  <td className={`${SETTINGS_TABLE_CELL} ${detailColumn}`}>
                    {person.isAdmin ? T.admin : T.regular}
                  </td>
                  <td className={`${SETTINGS_TABLE_CELL} ${detailColumn} text-muted-foreground`}>
                    {permissionSet}
                  </td>
                  <td className={`${SETTINGS_TABLE_CELL} ${detailColumn}`}>
                    {person.isActive ? T.yes : T.no}
                  </td>
                  <td className={`${SETTINGS_TABLE_CELL} align-top`}>
                    <UserRowControls
                      userId={person.id}
                      userName={person.name}
                      isAdmin={person.isAdmin}
                      isActive={person.isActive}
                      viewerIsAdmin={viewerIsAdmin}
                      permissionSetId={person.permissionSetId}
                      permissionSets={permissionSets}
                      onChanged={onChanged}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SettingsCard>
  );
}
