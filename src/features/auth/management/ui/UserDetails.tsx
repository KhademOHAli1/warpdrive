"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ManagementSnapshot, ManagementUser } from "../contracts";
import type { ManagementMessages } from "../messages";
import { ManagementStatus } from "./ManagementStatus";
import type { AskManagementAction } from "./types";
import { UserSecurityDetails } from "./UserSecurityDetails";
import { useManagementFormat } from "./useManagementFormat";

export function UserDetails({
  L,
  user,
  snapshot,
  pending,
  ask,
}: {
  L: ManagementMessages;
  user: ManagementUser;
  snapshot: ManagementSnapshot;
  pending: boolean;
  ask: AskManagementAction;
}) {
  const format = useManagementFormat();
  const [recipient, setRecipient] = useState("");
  const invitation = user.invitation;
  return (
    <Tabs defaultValue="access" className="gap-0">
      <TabsList className="gap-1 border-b pb-3" aria-label={L.details}>
        <TabsTrigger value="access" className={PILL_TAB}>
          {L.accessTab}
        </TabsTrigger>
        {snapshot.viewerIsAdmin && (
          <>
            <TabsTrigger value="security" className={PILL_TAB}>
              {L.securityTab}
            </TabsTrigger>
            <TabsTrigger value="ownership" className={PILL_TAB}>
              {L.ownershipTab}
            </TabsTrigger>
          </>
        )}
      </TabsList>
      <TabsContent value="access" className="mt-0 divide-y">
        <div className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">{L.permissionSet}</h3>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">{L.permissionHelp}</p>
          </div>
          <div className="min-w-44">
            <Select
              ariaLabel={L.permissionSet}
              value={user.permissionSetId ?? ""}
              onChange={(setId) => {
                if (setId !== "") ask({ action: "setPermissionSet", userId: user.id, setId });
              }}
              options={snapshot.permissionSets.map((set) => ({ value: set.id, label: set.name }))}
              placeholder={L.permissionSet}
              disabled={pending || (!snapshot.viewerIsAdmin && user.isAdmin)}
            />
          </div>
        </div>
        {snapshot.viewerIsAdmin && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 py-5">
              <div>
                <h3 className="text-sm font-medium">{L.adminRole}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {user.isAdmin ? L.enabled : L.notEnabled}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => ask({ action: "setAdmin", userId: user.id, isAdmin: !user.isAdmin })}
              >
                {user.isAdmin ? L.removeAdmin : L.makeAdmin}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 py-5">
              <div className="space-y-2">
                <h3 className="text-sm font-medium">{L.accountAccess}</h3>
                <ManagementStatus
                  state={
                    !user.isActive ? "inactive" : user.invitedAt !== null ? "pending" : "active"
                  }
                  L={L}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  ask(
                    { action: "setActive", userId: user.id, isActive: !user.isActive },
                    user.isActive ? L.suspendHelp : L.accessHelp,
                  )
                }
              >
                {user.isActive ? L.suspend : L.reactivate}
              </Button>
            </div>
          </>
        )}
        {invitation !== null && (
          <div className="space-y-3 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-medium">{L.invitation}</h3>
              <ManagementStatus state={invitation.state} L={L} />
            </div>
            <p className="text-xs text-muted-foreground">
              {L.expires}: {format.date(invitation.expiresAt)}
            </p>
            {user.invitedAt !== null && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !user.isActive || (!snapshot.viewerIsAdmin && user.isAdmin)}
                  onClick={() => ask({ action: "resendInvitation", id: invitation.id })}
                >
                  {L.resend}
                </Button>
                {invitation.state === "pending" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending || (!snapshot.viewerIsAdmin && user.isAdmin)}
                    onClick={() => ask({ action: "revokeInvitation", id: invitation.id })}
                  >
                    {L.revokeInvitation}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </TabsContent>
      {snapshot.viewerIsAdmin && (
        <>
          <TabsContent value="security" className="mt-5 space-y-5">
            <UserSecurityDetails
              L={L}
              userId={user.id}
              revision={snapshot.audit[0]?.id ?? String(user.activeSessions)}
              ask={ask}
              pending={pending}
            />
            <div className="space-y-3 border-t pt-5">
              <h3 className="text-sm font-medium">{L.revokeAccess}</h3>
              <p className="text-sm text-muted-foreground">{L.revokeHelp}</p>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => ask({ action: "revokeAccess", userId: user.id }, L.revokeHelp)}
              >
                {L.revokeAccess}
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="ownership" className="mt-5 space-y-5">
            <div>
              <h3 className="text-sm font-medium">{L.transferTitle}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{L.transferHelp}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="min-w-48 flex-1">
                <Select
                  ariaLabel={L.recipient}
                  value={recipient}
                  onChange={setRecipient}
                  options={snapshot.assignees
                    .filter((candidate) => candidate.id !== user.id)
                    .map((candidate) => ({ value: candidate.id, label: candidate.name }))}
                  placeholder={L.chooseUser}
                />
              </div>
              <Button
                disabled={pending || recipient === ""}
                onClick={() =>
                  ask(
                    { action: "transferOwnership", fromUserId: user.id, toUserId: recipient },
                    L.transferHelp,
                  )
                }
              >
                {L.transfer}
              </Button>
            </div>
          </TabsContent>
        </>
      )}
    </Tabs>
  );
}
