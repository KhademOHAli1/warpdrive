"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useNewsletterRead, useNewsletterWrite } from "@/features/newsletter/ui/client";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  AudiencePagination,
  AudienceRefresh,
  AudienceSearch,
  AudienceTable,
  AudienceWriteError,
} from "./components";
import {
  type AudiencePage,
  canRequestOptin,
  type MinimalList,
  type Subscriber,
  subscriptionStatus,
} from "./contracts";
import { type AudienceMessages, useAudienceMessages } from "./messages";
import { SubscriberEditor } from "./SubscriberEditor";
import { SubscriberMemberships } from "./SubscriberMemberships";

type SubscriberCommand = "blocklist" | "optin";

function commandCopy(L: AudienceMessages, command: SubscriberCommand | undefined) {
  if (command === "blocklist")
    return { title: L.blocklistTitle, description: L.blocklistDetail, label: L.blocklist };
  return { title: L.optinTitle, description: L.optinDetail, label: L.sendOptin };
}

function SubscriberRow({
  row,
  edit,
  manage,
  confirm,
  pending,
}: {
  row: Subscriber;
  edit: (row: Subscriber) => void;
  manage: (id: number) => void;
  confirm: (kind: SubscriberCommand, id: number) => void;
  pending: boolean;
}) {
  const L = useAudienceMessages();
  return (
    <tr className="hover:bg-muted/30">
      <td className="min-w-40 px-4 py-3 font-medium">
        <bdi dir="auto">{row.name}</bdi>
      </td>
      <td className="max-w-80 break-all px-4 py-3">
        <bdi dir="ltr">{row.email}</bdi>
      </td>
      <td className="px-4 py-3">
        <Badge variant={row.status === "blocklisted" ? "destructive" : "secondary"}>
          {L[row.status]}
        </Badge>
      </td>
      <td className="min-w-48 px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {row.lists.slice(0, 5).map((item) => (
            <Badge
              key={item.id}
              variant={item.subscription_status === "confirmed" ? "success" : "outline"}
              title={L[item.subscription_status]}
            >
              <bdi dir="auto" className="max-w-48 truncate">
                {item.name}
              </bdi>
            </Badge>
          ))}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" onClick={() => edit(row)}>
            {L.edit}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => manage(row.id)}>
            {L.manageMemberships}
          </Button>
          {row.status !== "blocklisted" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => confirm("blocklist", row.id)}
            >
              {L.blocklist}
            </Button>
          )}
          {canRequestOptin(row) && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => confirm("optin", row.id)}
            >
              {L.sendOptin}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function SubscribersScreen() {
  const L = useAudienceMessages();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [listId, setListId] = useState("");
  const [subStatus, setSubStatus] = useState("");
  const [editor, setEditor] = useState<{ row: Subscriber | null } | null>(null);
  const [memberships, setMemberships] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<{ kind: SubscriberCommand; id: number } | null>(
    null,
  );
  const read = useNewsletterRead<AudiencePage<Subscriber>>("subscribers.page", {
    page,
    search,
    ...(listId !== "" ? { listId: Number(listId) } : {}),
    ...(subStatus !== "" ? { subscriptionStatus: subStatus } : {}),
  });
  const lists = useNewsletterRead<MinimalList[]>("lists.minimal");
  const write = useNewsletterWrite();
  const rows = read.data?.results ?? [];
  const copy = commandCopy(L, confirmation?.kind);

  function runConfirmed() {
    if (!confirmation) return;
    void write
      .run(`subscribers.${confirmation.kind}`, { id: confirmation.id })
      .then(() => setConfirmation(null))
      .catch(() => undefined);
  }

  return (
    <section className={`space-y-4 ${BLOCK_CLASS} ph-no-capture`}>
      <PageHeading
        title={L.allSubscribers}
        actions={
          <Button onClick={() => setEditor({ row: null })}>
            <Plus className="size-4" aria-hidden="true" />
            {L.newSubscriber}
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <AudienceSearch
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
        <Select
          ariaLabel={L.listFilter}
          value={listId}
          triggerClassName="w-auto min-w-40"
          contentClassName={`${BLOCK_CLASS} ph-no-capture`}
          onChange={(value) => {
            setListId(value);
            setPage(1);
          }}
          options={[
            { value: "", label: L.listFilter },
            ...(lists.data ?? []).map((item) => ({ value: String(item.id), label: item.name })),
          ]}
        />
        <Select
          ariaLabel={L.subscriptionFilter}
          value={subStatus}
          triggerClassName="w-auto min-w-40"
          onChange={(value) => {
            setSubStatus(value);
            setPage(1);
          }}
          options={[
            { value: "", label: L.subscriptionFilter },
            ...subscriptionStatus.options.map((value) => ({ value, label: L[value] })),
          ]}
        />
        <AudienceRefresh read={read} />
      </div>
      <AudienceWriteError error={write.error} />
      <AudienceTable
        labels={[L.name, L.email, L.status, L.lists, L.actions]}
        empty={L.emptySubscribers}
        read={read}
        count={rows.length}
      >
        {rows.map((row) => (
          <SubscriberRow
            key={row.id}
            row={row}
            pending={write.isPending}
            edit={(value) => setEditor({ row: value })}
            manage={setMemberships}
            confirm={(kind, id) => setConfirmation({ kind, id })}
          />
        ))}
      </AudienceTable>
      <AudiencePagination
        page={page}
        total={read.data?.total ?? 0}
        busy={read.isFetching}
        onPageChange={setPage}
      />
      {editor && <SubscriberEditor row={editor.row} close={() => setEditor(null)} />}
      {memberships !== null && (
        <SubscriberMemberships id={memberships} close={() => setMemberships(null)} />
      )}
      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.label}
        destructive={confirmation?.kind !== "optin"}
        pending={write.isPending}
        onConfirm={runConfirmed}
      />
    </section>
  );
}
