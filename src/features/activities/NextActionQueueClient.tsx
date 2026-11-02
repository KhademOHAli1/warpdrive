"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useLocalePreferencePending, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { AddActivityModal } from "./AddActivityModal";
import { CalendarEventEditDialog } from "./CalendarEventEditDialog";
import { NextActionQueue } from "./NextActionQueue";
import type { NextActionQueueInput } from "./next-action-queue/queueTypes";

export function NextActionQueueClient({ currentUserId }: { currentUserId: string }): ReactNode {
  return <ActorQueue key={currentUserId} currentUserId={currentUserId} />;
}

type QueueDialog = { kind: "edit" | "schedule"; id: string } | null;

function ActorQueue({ currentUserId }: { currentUserId: string }): ReactNode {
  const utils = trpc.useUtils();
  const client = useQueryClient();
  const preferences = useLocalePreferences();
  const preferencesPending = useLocalePreferencePending();
  const [input, setInput] = useState<NextActionQueueInput>({ scope: "mine", limit: 25, offset: 0 });
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<QueueDialog>(null);
  // This identity scopes client data only; the server resolves its caller independently.
  const actorKey = ["activities.nextActionQueue", currentUserId] as const;
  const query = useQuery({
    queryKey: [
      ...actorKey,
      input.scope,
      input.limit,
      input.offset,
      preferences.locale,
      preferences.calendar,
      preferences.timeZone,
      preferences.numberingSystem,
      preferencesPending,
      revision,
    ],
    queryFn: ({ signal }) => utils.client.activities.nextActionQueue.query(input, { signal }),
    enabled: currentUserId !== "" && !preferencesPending,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  function refresh(): void {
    void client.cancelQueries({ queryKey: actorKey });
    // A new key also discards late pre-save responses if transport cancellation loses a race.
    setRevision((before) => before + 1);
  }

  function saved(): void {
    setDialog(null);
    refresh();
  }

  return (
    <>
      <NextActionQueue
        input={input}
        page={query.data ?? null}
        loading={
          preferencesPending || (currentUserId !== "" && (query.isPending || query.isFetching))
        }
        error={currentUserId === "" || query.isError}
        onScopeChange={(scope) => {
          setDialog(null);
          setInput((before) => ({ ...before, scope, offset: 0 }));
        }}
        onPageChange={(offset) => {
          setDialog(null);
          setInput((before) => ({ ...before, offset }));
        }}
        onRefresh={refresh}
        onEditActivity={(row) => setDialog({ kind: "edit", id: row.id })}
        onScheduleDeal={(row) => setDialog({ kind: "schedule", id: row.id })}
      />
      {dialog?.kind === "edit" && (
        <CalendarEventEditDialog
          key={`activity:${dialog.id}`}
          id={dialog.id}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.kind === "schedule" && (
        <AddActivityModal
          key={`deal:${dialog.id}`}
          dealId={dialog.id}
          onClose={() => setDialog(null)}
          onCreated={saved}
        />
      )}
    </>
  );
}
