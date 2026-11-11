"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useNewsletterWrite } from "@/features/newsletter/ui/client";
import { useFormatters } from "@/lib/useFormatters";
import { AudienceWriteError } from "./components";
import type { MinimalList } from "./contracts";
import { useAudienceMessages } from "./messages";

type Confirmation =
  | { kind: "blocklist"; ids: number[] }
  | { kind: "unsubscribe"; ids: number[]; list: MinimalList };

export function SubscriberBulkActions({
  ids,
  lists,
  filteredList,
  clear,
  busy,
}: {
  ids: number[];
  lists: MinimalList[];
  filteredList: string;
  clear: () => void;
  busy: boolean;
}) {
  const L = useAudienceMessages();
  const format = useFormatters();
  const [listId, setListId] = useState(filteredList);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const write = useNewsletterWrite();
  const list = lists.find((option) => String(option.id) === listId);
  const isBlocklist = confirmation?.kind === "blocklist";
  const count = format.number(confirmation?.ids.length ?? ids.length);
  const description =
    confirmation?.kind === "unsubscribe"
      ? L.bulkUnsubscribeDetail.replace("{count}", count).replace("{list}", confirmation.list.name)
      : L.bulkBlocklistDetail.replace("{count}", count);

  function confirm() {
    if (confirmation === null) return;
    const input = { ids: confirmation.ids, confirmed: true };
    const action =
      confirmation.kind === "blocklist"
        ? write.run("subscribers.bulkBlocklist", input)
        : write.run("subscribers.bulkUnsubscribe", { ...input, listId: confirmation.list.id });
    void action.then(clear).catch(() => undefined);
  }

  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-2 text-sm font-medium">
          {L.bulkSelected.replace("{count}", format.number(ids.length))}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || write.isPending}
          onClick={() => setConfirmation({ kind: "blocklist", ids })}
        >
          {L.bulkBlocklist}
        </Button>
        <Select
          ariaLabel={L.bulkChooseList}
          value={listId}
          onChange={setListId}
          triggerClassName="w-auto min-w-36"
          options={[
            { value: "", label: L.bulkChooseList },
            ...lists.map((option) => ({ value: String(option.id), label: option.name })),
          ]}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={list === undefined || busy || write.isPending}
          onClick={() => {
            if (list) setConfirmation({ kind: "unsubscribe", ids, list });
          }}
        >
          {L.bulkUnsubscribe}
        </Button>
        <Button size="sm" variant="ghost" disabled={write.isPending} onClick={clear}>
          {L.clearSelection}
        </Button>
      </div>
      <AudienceWriteError error={write.error} />
      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        title={isBlocklist ? L.bulkBlocklistTitle : L.bulkUnsubscribeTitle}
        description={description}
        confirmLabel={isBlocklist ? L.blocklist : L.unsubscribe}
        destructive
        pending={write.isPending}
        onConfirm={confirm}
      />
    </div>
  );
}
