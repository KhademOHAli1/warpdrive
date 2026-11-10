"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNewsletterRead, useNewsletterWrite } from "@/features/newsletter/ui/client";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { AudienceListPicker, AudienceReadError, AudienceWriteError } from "./components";
import type { MinimalList, Subscriber } from "./contracts";
import { useAudienceMessages } from "./messages";

export function SubscriberMemberships({ id, close }: { id: number; close: () => void }) {
  const L = useAudienceMessages();
  const [lists, setLists] = useState<number[]>([]);
  const [unsubscribe, setUnsubscribe] = useState<number | null>(null);
  const read = useNewsletterRead<Subscriber>("subscribers.get", { id });
  const available = useNewsletterRead<MinimalList[]>("lists.minimal");
  const write = useNewsletterWrite();
  const memberships = read.data?.lists ?? [];
  const choices = (available.data ?? []).filter(
    (list) => !memberships.some((item) => item.id === list.id),
  );

  function assign() {
    void write
      .run("subscribers.assignLists", { id, lists })
      .then(() => setLists([]))
      .catch(() => undefined);
  }

  function revoke() {
    if (unsubscribe === null) return;
    void write.run("subscribers.unsubscribe", { id, listId: unsubscribe }).catch(() => undefined);
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !write.isPending) close();
        }}
      >
        <DialogContent className={`max-h-[90dvh] overflow-y-auto ${BLOCK_CLASS} ph-no-capture`}>
          <DialogHeader>
            <DialogTitle>{L.memberships}</DialogTitle>
            <DialogDescription>{L.membershipDetail}</DialogDescription>
          </DialogHeader>
          {read.isLoading && (
            <p role="status" className="text-sm text-muted-foreground">
              {L.loading}
            </p>
          )}
          {read.error && <AudienceReadError read={read} />}
          {read.data && (
            <div className="space-y-4">
              {memberships.length === 0 && (
                <p className="text-sm text-muted-foreground">{L.emptyMemberships}</p>
              )}
              {memberships.length > 0 && (
                <ul className="divide-y rounded-md border">
                  {memberships.map((list) => (
                    <li
                      key={list.id}
                      className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                    >
                      <bdi dir="auto" className="grow break-all">
                        {list.name}
                      </bdi>
                      <Badge variant="secondary">{L[list.subscription_status]}</Badge>
                      {list.subscription_status !== "unsubscribed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={write.isPending}
                          onClick={() => setUnsubscribe(list.id)}
                        >
                          {L.unsubscribe}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {read.data.status !== "blocklisted" && (
                <AudienceListPicker
                  lists={choices}
                  value={lists}
                  onChange={setLists}
                  read={available}
                />
              )}
            </div>
          )}
          <AudienceWriteError error={write.error} />
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={write.isPending}>
              {L.cancel}
            </Button>
            {read.data && read.data.status !== "blocklisted" && (
              <Button disabled={lists.length === 0 || write.isPending} onClick={assign}>
                {L.assignLists}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={unsubscribe !== null}
        onOpenChange={(open) => {
          if (!open) setUnsubscribe(null);
        }}
        title={L.unsubscribeTitle}
        description={L.unsubscribeDetail}
        confirmLabel={L.unsubscribe}
        destructive
        pending={write.isPending}
        onConfirm={revoke}
      />
    </>
  );
}
