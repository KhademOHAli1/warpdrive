"use client";
import { ChevronRight, Search } from "lucide-react";
import { useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ManagementQuery, ManagementSnapshot } from "../contracts";
import type { ManagementMessages } from "../messages";
import { ManagementStatus } from "./ManagementStatus";
import type { AskManagementAction } from "./types";
import { UserDetails } from "./UserDetails";
import { useManagementFormat } from "./useManagementFormat";

export function UserDirectory({
  L,
  snapshot,
  query,
  setQuery,
  pending,
  ask,
}: {
  L: ManagementMessages;
  snapshot: ManagementSnapshot;
  query: ManagementQuery;
  setQuery: (query: ManagementQuery) => void;
  pending: boolean;
  ask: AskManagementAction;
}) {
  const format = useManagementFormat();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<string | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const visibleIds = snapshot.users.map((user) => user.id);
  const chosenIds = visibleIds.filter((id) => selected.has(id));
  const target = snapshot.users.find((user) => user.id === details);
  return (
    <section className="space-y-4" aria-label={L.details}>
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-48 flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute start-3 top-2.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label={L.search}
            placeholder={L.search}
            value={query.q}
            onChange={(event) => setQuery({ ...query, q: event.target.value, page: 1 })}
            className="ps-9"
          />
        </div>
        <div className="w-full sm:w-48">
          <Select
            ariaLabel={L.status}
            value={query.status}
            onChange={(status) =>
              setQuery({ ...query, status: status as ManagementQuery["status"], page: 1 })
            }
            options={[
              { value: "all", label: L.all },
              { value: "active", label: L.active },
              { value: "pending", label: L.pending },
              { value: "inactive", label: L.inactive },
            ]}
          />
        </div>
      </div>
      {snapshot.viewerIsAdmin && chosenIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              ask({ action: "bulkActive", userIds: chosenIds, isActive: false }, L.bulkHelp)
            }
          >
            {L.suspendSelected}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              ask({ action: "bulkActive", userIds: chosenIds, isActive: true }, L.bulkHelp)
            }
          >
            {L.reactivateSelected}
          </Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[580px] text-start text-sm">
          <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
            <tr>
              {snapshot.viewerIsAdmin && (
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    label={L.selectAll}
                    checked={
                      chosenIds.length === 0
                        ? false
                        : chosenIds.length === visibleIds.length
                          ? true
                          : "indeterminate"
                    }
                    onCheckedChange={(checked) =>
                      setSelected(checked ? new Set(visibleIds) : new Set())
                    }
                  />
                </th>
              )}
              {[L.name, L.role, L.status, L.sessions, L.actions].map((label) => (
                <th key={label} className="px-4 py-3 text-start font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {snapshot.users.map((user) => (
              <tr
                key={user.id}
                data-selected={selected.has(user.id)}
                className="border-b transition-colors last:border-0 hover:bg-accent/30 data-[selected=true]:bg-accent/40 motion-reduce:transition-none"
              >
                {snapshot.viewerIsAdmin && (
                  <td className="px-4 py-3.5">
                    <Checkbox
                      label={`${L.selectUser}: ${user.name}`}
                      checked={selected.has(user.id)}
                      onCheckedChange={(checked) =>
                        setSelected((prior) => {
                          const next = new Set(prior);
                          if (checked) next.add(user.id);
                          else next.delete(user.id);
                          return next;
                        })
                      }
                    />
                  </td>
                )}
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={user.name} className="size-8 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium">{user.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <bdi dir="ltr">{user.email}</bdi>
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  {user.isAdmin ? (
                    <Badge variant="outline" className="font-normal">
                      {L.admin}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">{L.member}</span>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <ManagementStatus
                    state={
                      !user.isActive ? "inactive" : user.invitedAt !== null ? "pending" : "active"
                    }
                    L={L}
                  />
                </td>
                <td className="px-4 py-3.5 tabular-nums text-muted-foreground">
                  {format.number(user.activeSessions)}
                </td>
                <td className="px-4 py-3.5 text-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      returnFocus.current = event.currentTarget;
                      setDetails(user.id);
                    }}
                    aria-label={`${L.details}: ${user.name}`}
                  >
                    {L.details}
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {snapshot.users.length === 0 && (
          <p className="p-5 text-sm text-muted-foreground">{L.noUsers}</p>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <Button
          variant="outline"
          size="sm"
          disabled={snapshot.page <= 1}
          onClick={() => setQuery({ ...query, page: snapshot.page - 1 })}
        >
          {L.previous}
        </Button>
        <span>
          {L.page} {format.number(snapshot.page)} {L.of} {format.number(snapshot.pageCount)}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={snapshot.page >= snapshot.pageCount}
          onClick={() => setQuery({ ...query, page: snapshot.page + 1 })}
        >
          {L.next}
        </Button>
      </div>
      <Dialog
        open={target !== undefined}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected === true) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{target?.name ?? L.details}</DialogTitle>
            <DialogDescription>
              <bdi dir="ltr">{target?.email}</bdi>
            </DialogDescription>
          </DialogHeader>
          {target !== undefined && (
            <UserDetails
              key={target.id}
              L={L}
              user={target}
              snapshot={snapshot}
              pending={pending}
              ask={ask}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
