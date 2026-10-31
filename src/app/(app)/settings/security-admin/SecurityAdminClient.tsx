"use client";
import { Check, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ManagementQuery } from "@/features/auth/management/contracts";
import {
  type ManagementMessages,
  managementMessagesForLocale,
} from "@/features/auth/management/messages";
import type { ManagementAction } from "@/features/auth/management/schemas";
import { AdministrationRecords } from "@/features/auth/management/ui/AdministrationRecords";
import { AuditPanel } from "@/features/auth/management/ui/AuditPanel";
import { InvitationForm } from "@/features/auth/management/ui/InvitationForm";
import { PolicyForm } from "@/features/auth/management/ui/PolicyForm";
import { UserDirectory } from "@/features/auth/management/ui/UserDirectory";
import { useManagementFormat } from "@/features/auth/management/ui/useManagementFormat";
import { useManagement } from "@/features/auth/management/useManagement";
import { useLocale } from "@/features/i18n/LocaleProvider";

export function SecurityAdminClient() {
  const L = managementMessagesForLocale(useLocale());
  const [query, setQuery] = useState<ManagementQuery>({ q: "", status: "all", page: 1 });
  const state = useManagement(query);
  const format = useManagementFormat();
  const [dialog, setDialog] = useState<"invite" | "policy" | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const openDialog = (name: "invite" | "policy", trigger: HTMLButtonElement) => {
    returnFocus.current = trigger;
    setDialog(name);
  };
  const [confirmation, setConfirmation] = useState<{
    command: ManagementAction;
    description: string;
  } | null>(null);
  const ask = (command: ManagementAction, description = L.accessHelp) =>
    setConfirmation({ command, description });
  const notice = <ManagementNotice error={state.error} L={L} reload={state.reload} />;
  const sendDialog = async (command: ManagementAction) => {
    const success = await state.send(command);
    if (success) setDialog(null);
    return success;
  };
  return (
    <div className="space-y-5">
      {dialog === null && notice}
      {state.saved && (
        <p role="status" className="flex items-center gap-2 text-sm text-success">
          <Check className="size-4" aria-hidden="true" />
          {L.saved}
        </p>
      )}
      {state.snapshot === null ? (
        state.error === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            {L.loading}
          </p>
        ) : null
      ) : (
        <>
          {state.snapshot.viewerIsAdmin && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card px-4 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <ShieldCheck className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">{L.policyTitle}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {state.snapshot.policy.requireMfaForAll ? L.mfaEveryone : L.mfaAdministrators}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => openDialog("policy", event.currentTarget)}
              >
                {L.managePolicy}
              </Button>
            </div>
          )}
          <Tabs defaultValue="people" className="gap-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
              <TabsList
                variant="line"
                className="max-w-full gap-4 overflow-x-auto"
                aria-label={L.title}
              >
                {[
                  { value: "people", label: L.peopleTab },
                  ...(state.snapshot.viewerIsAdmin
                    ? [{ value: "requests", label: L.requestsTab }]
                    : []),
                  { value: "delivery", label: L.deliveryTab },
                  ...(state.snapshot.viewerIsAdmin
                    ? [{ value: "activity", label: L.activityTab }]
                    : []),
                ].map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="rounded-none border-x-0 border-t-0 border-b-2 border-transparent px-0 py-2 text-muted-foreground shadow-none after:hidden data-active:border-b-foreground data-active:bg-transparent data-active:text-foreground data-[state=active]:border-b-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground"
                  >
                    {tab.label}
                    {tab.value === "requests" &&
                      state.snapshot !== null &&
                      state.snapshot.requests.some((request) => request.status === "pending") && (
                        <span className="size-1.5 rounded-full bg-action" aria-hidden="true" />
                      )}
                  </TabsTrigger>
                ))}
              </TabsList>
              <Button size="sm" onClick={(event) => openDialog("invite", event.currentTarget)}>
                <Plus className="size-4" aria-hidden="true" />
                {L.inviteTitle}
              </Button>
            </div>
            <TabsContent value="people" className="mt-5 space-y-4">
              <p className="text-xs text-muted-foreground">
                {format.number(state.snapshot.total)} {L.accountsFound}
              </p>
              <UserDirectory
                L={L}
                snapshot={state.snapshot}
                query={query}
                setQuery={setQuery}
                pending={state.pending}
                ask={ask}
              />
            </TabsContent>
            <TabsContent value="requests" className="mt-5">
              <AdministrationRecords
                view="requests"
                L={L}
                snapshot={state.snapshot}
                pending={state.pending}
                send={state.send}
                ask={ask}
              />
            </TabsContent>
            <TabsContent value="delivery" className="mt-5">
              <AdministrationRecords
                view="delivery"
                L={L}
                snapshot={state.snapshot}
                pending={state.pending}
                send={state.send}
                ask={ask}
              />
            </TabsContent>
            <TabsContent value="activity" className="mt-5">
              <AuditPanel L={L} snapshot={state.snapshot} query={query} setQuery={setQuery} />
            </TabsContent>
          </Tabs>
          <Dialog
            open={dialog !== null}
            onOpenChange={(open) => {
              if (!open && !state.pending) setDialog(null);
            }}
          >
            <DialogContent
              className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
              onCloseAutoFocus={(event) => {
                if (returnFocus.current?.isConnected === true) {
                  event.preventDefault();
                  returnFocus.current.focus();
                }
              }}
            >
              <DialogHeader>
                <DialogTitle>{dialog === "policy" ? L.policyTitle : L.inviteTitle}</DialogTitle>
                <DialogDescription>
                  {dialog === "policy" ? L.policyHelp : L.inviteDescription}
                </DialogDescription>
              </DialogHeader>
              {notice}
              {dialog === "policy" ? (
                <PolicyForm
                  key={JSON.stringify(state.snapshot.policy)}
                  L={L}
                  policy={state.snapshot.policy}
                  pending={state.pending}
                  send={sendDialog}
                />
              ) : (
                <InvitationForm
                  L={L}
                  pending={state.pending}
                  send={sendDialog}
                  viewerIsAdmin={state.snapshot.viewerIsAdmin}
                />
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        title={L.confirm}
        description={confirmation?.description ?? L.accessHelp}
        confirmLabel={L.confirm}
        cancelLabel={L.cancel}
        pending={state.pending}
        onConfirm={() => {
          const command = confirmation?.command;
          setConfirmation(null);
          if (command !== undefined) void state.send(command);
        }}
      />
    </div>
  );
}

function ManagementNotice({
  error,
  L,
  reload,
}: {
  error: string | null;
  L: ManagementMessages;
  reload: () => void;
}) {
  if (error === null) return null;
  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <p>{managementErrorMessage(error, L)}</p>
      <div className="flex items-center gap-3">
        <Link href="/settings/security" className="font-medium underline underline-offset-4">
          {L.securitySettings}
        </Link>
        <Button size="sm" variant="ghost" onClick={reload}>
          {L.retry}
        </Button>
      </div>
    </div>
  );
}

function managementErrorMessage(error: string | null, L: ManagementMessages): string {
  const messages: Record<string, string> = {
    fresh_auth_required: L.freshRequired,
    unauthorized: L.freshRequired,
    bulk_partial: L.bulkPartial,
    forbidden: L.forbidden,
    email_taken: L.emailTaken,
    not_found: L.notFound,
    invalid_invitation: L.notFound,
    invalid_input: L.invalid,
    invalid_policy: L.invalid,
    load_error: L.loadError,
    rate_limited: L.rateLimited,
  };
  if (error?.includes("last active admin") === true) return L.lastAdminProtected;
  if (error === "cannot deactivate yourself") return L.selfSuspendProtected;
  if (error === "cannot reassign your own permission set") return L.ownPermissionProtected;
  return messages[error ?? ""] ?? L.failed;
}
