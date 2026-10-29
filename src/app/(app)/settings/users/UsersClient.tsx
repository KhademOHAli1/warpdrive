"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_HEAD,
  SETTINGS_TABLE_HEADER_CELL,
  SETTINGS_TABLE_ROW,
  SettingsCard,
} from "../SettingsSurface";
import { InviteUserForm } from "./InviteUserForm";
import { UserRowControls } from "./UserRowControls";
import { UserStatusTabs } from "./UserStatusTabs";
import { filterUsersByStatus, parseUserStatusFilter, type UserStatusFilter } from "./userStatus";

interface UserRow {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  isActive: boolean;
  invitedAt: string | null;
  permissionSetId: string | null;
}

interface PermissionSetOption {
  id: string;
  name: string;
}

interface Props {
  rows: UserRow[];
  permissionSets: PermissionSetOption[];
  viewerIsAdmin: boolean;
}

export function UsersClient({ rows, permissionSets, viewerIsAdmin }: Props): React.ReactElement {
  const L = useSettingsMessages();

  const V = {
    admin: L._extra.admin,
    regular: L._extra.regular,
    yes: L._extra.yes,
    no: L._extra.no,
    invited: L._extra.invited,
    noSet: L._extra.none,
  } as const;

  const C = {
    name: L._extra.name,
    email: L._extra.email,
    role: L._extra.role,
    permissionSet: L._extra.permission_set,
    active: L._extra.active,
    actions: L._extra.actions,
  } as const;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const status = parseUserStatusFilter(searchParams.get("status"));
  const visible = filterUsersByStatus(rows, status);
  const setNames = new Map(permissionSets.map((s) => [s.id, s.name]));

  function setStatus(next: UserStatusFilter): void {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("status");
    else params.set("status", next);
    const query = params.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <InviteUserForm onInvited={() => router.refresh()} />
      <div className="space-y-3">
        <UserStatusTabs value={status} onChange={setStatus} />
        <SettingsCard className="shadow-none">
          {/* Own scroll container: on the card itself, overflow-x-auto competes with the card's
              overflow-hidden and the action column ends up clipped instead of scrollable. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className={SETTINGS_TABLE_HEAD}>
                <tr className="border-b">
                  <th className={SETTINGS_TABLE_HEADER_CELL}>{C.name}</th>
                  <th className={SETTINGS_TABLE_HEADER_CELL}>{C.email}</th>
                  <th className={SETTINGS_TABLE_HEADER_CELL}>{C.role}</th>
                  <th className={SETTINGS_TABLE_HEADER_CELL}>{C.permissionSet}</th>
                  <th className={SETTINGS_TABLE_HEADER_CELL}>{C.active}</th>
                  <th className={SETTINGS_TABLE_HEADER_CELL}>{C.actions}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <tr key={u.id} className={SETTINGS_TABLE_ROW}>
                    <td className={SETTINGS_TABLE_CELL}>
                      {u.name}
                      {u.invitedAt !== null && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {V.invited}
                        </span>
                      )}
                    </td>
                    <td className={`${SETTINGS_TABLE_CELL} text-muted-foreground`}>{u.email}</td>
                    <td className={SETTINGS_TABLE_CELL}>{u.isAdmin ? V.admin : V.regular}</td>
                    <td className={`${SETTINGS_TABLE_CELL} text-muted-foreground`}>
                      {u.permissionSetId === null
                        ? V.noSet
                        : (setNames.get(u.permissionSetId) ?? V.noSet)}
                    </td>
                    <td className={SETTINGS_TABLE_CELL}>{u.isActive ? V.yes : V.no}</td>
                    <td className={SETTINGS_TABLE_CELL}>
                      <UserRowControls
                        userId={u.id}
                        isAdmin={u.isAdmin}
                        isActive={u.isActive}
                        viewerIsAdmin={viewerIsAdmin}
                        permissionSetId={u.permissionSetId}
                        permissionSets={permissionSets}
                        onChanged={() => router.refresh()}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
