"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { managementMessagesForLocale } from "@/features/auth/management/messages";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { InviteUserDialog } from "./InviteUserDialog";
import type { PermissionSetOption, UserRow } from "./types";
import { UserStatusTabs } from "./UserStatusTabs";
import { UsersDirectory } from "./UsersDirectory";
import { filterUsersByStatus, parseUserStatusFilter, type UserStatusFilter } from "./userStatus";

interface Props {
  rows: UserRow[];
  permissionSets: PermissionSetOption[];
  viewerIsAdmin: boolean;
}

export function UsersClient({ rows, permissionSets, viewerIsAdmin }: Props): React.ReactElement {
  const L = useSettingsMessages();
  const locale = useLocale();
  const M = managementMessagesForLocale(locale);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const status = parseUserStatusFilter(searchParams.get("status"));
  const search = query.normalize("NFKC").trim().toLocaleLowerCase(locale);
  const visible = filterUsersByStatus(rows, status).filter((person) =>
    `${person.name} ${person.email}`.normalize("NFKC").toLocaleLowerCase(locale).includes(search),
  );

  function setStatus(next: UserStatusFilter): void {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("status");
    else params.set("status", next);
    const value = params.toString();
    router.replace(value === "" ? pathname : `${pathname}?${value}`, { scroll: false });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-lg text-sm text-muted-foreground">
          {L._hierarchy.peopleScopeDescription}
        </p>
        <InviteUserDialog viewerIsAdmin={viewerIsAdmin} onInvited={() => router.refresh()} />
      </div>
      <div className="space-y-3">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={L._hierarchy.peopleSearch}
          placeholder={L._hierarchy.peopleSearch}
          className="sm:max-w-sm"
        />
        <UserStatusTabs value={status} onChange={setStatus} />
        <UsersDirectory
          rows={visible}
          permissionSets={permissionSets}
          viewerIsAdmin={viewerIsAdmin}
          onChanged={() => router.refresh()}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {L._hierarchy.peopleSecurityHelp}{" "}
        <Link
          href="/settings/security-admin"
          className="font-medium text-link underline underline-offset-4"
        >
          {M.title}
        </Link>
      </p>
    </div>
  );
}
