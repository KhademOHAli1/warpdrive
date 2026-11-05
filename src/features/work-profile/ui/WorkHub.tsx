"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { useCompanyMessages } from "@/features/company-profile/messages";
import { CommandFeedback, ProfileError } from "@/features/company-profile/ui/CommandFeedback";
import { ChoiceField, PRIVATE } from "@/features/company-profile/ui/Fields";
import { useDepartureGuard } from "@/features/company-profile/ui/useDepartureGuard";
import { useProfileCommand, useProfileResource } from "@/features/company-profile/ui/useProfileApi";
import {
  commandSchema,
  itemsPageSchema,
  type Overview,
  optionsSchema,
  type WorkItem,
  workItemSchema,
} from "../contracts";
import { useWorkMessages } from "../messages";
import { draftForItem, ItemEditor } from "./ItemEditor";
import { WorkRecords } from "./WorkRecords";
import { matchWorkFilters, mergeWorkRecords, workItemsUrl } from "./workHubRecords";
export function WorkHub({ data, actorId }: { data: Overview; actorId: string }) {
  const m = useWorkMessages();
  const c = useCompanyMessages();
  const [typeId, setTypeId] = useState("");
  const [stageId, setStageId] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [board, setBoard] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<WorkItem[]>([]);
  const [local, setLocal] = useState<{ version: number | null; items: WorkItem[] }>({
    version: null,
    items: [],
  });
  const [editing, setEditing] = useState<{ item: WorkItem | null } | null>(null);
  const filters = { archived, typeId, stageId, query };
  const records = useProfileResource(workItemsUrl(filters, cursor), itemsPageSchema);
  const options = useProfileResource("/api/work-profile/options", optionsSchema);
  const scope = `work:${data.workspaceScope}:${actorId}`;
  const command = useProfileCommand(
    `${scope}:move`,
    commandSchema,
    workItemSchema,
    "/api/work-profile",
  );
  const locked = command.busy || command.command !== null;
  useDepartureGuard(command.command !== null, c.uncertain);
  const accept = (result: WorkItem | null) => {
    if (!result) return;
    const version = cursor === null ? records.version : null;
    setLocal((state) => ({
      version,
      items: [
        ...(state.version === version ? state.items : []).filter((entry) => entry.id !== result.id),
        result,
      ],
    }));
    if (cursor === null) void records.reload();
    else {
      setCursor(null);
      setPrevious([]);
    }
  };
  const resetPage = () => {
    setCursor(null);
    setPrevious([]);
    setLocal({ version: null, items: [] });
  };
  const all = mergeWorkRecords(
    [...previous, ...(records.data?.items ?? [])],
    local.version === records.version ? local.items : [],
  );
  const items = matchWorkFilters(all, filters);
  const nextCursor = records.data?.nextCursor ?? null;
  const type = data.workTypes.find((entry) => entry.id === typeId);
  const activeTypes = data.workTypes.filter((entry) => !entry.isArchived);
  return (
    <div className={`${PRIVATE} space-y-5`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{m.hubTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{m.hubIntro}</p>
        </div>
        <div className="flex gap-2">
          {data.permissions.manageProfile || data.permissions.manage ? (
            <Link
              className="rounded-md border px-3 py-2 text-sm"
              href="/settings/company/work-profile"
            >
              {m.setup}
            </Link>
          ) : null}
          {data.permissions.create ? (
            <Button
              disabled={locked || activeTypes.length === 0 || options.data === null}
              onClick={() => setEditing({ item: null })}
            >
              {m.newItem}
            </Button>
          ) : null}
        </div>
      </div>
      {activeTypes.length === 0 ? (
        <p className="rounded-lg border p-5 text-sm">{m.noTypes}</p>
      ) : null}
      <div className="grid items-end gap-4 rounded-lg border p-4 sm:grid-cols-2 xl:grid-cols-4">
        <ChoiceField
          label={m.workflow}
          value={typeId}
          options={[
            { value: "", label: m.allTypes },
            ...data.workTypes.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
          disabled={locked}
          onChange={(value) => {
            setTypeId(value);
            setStageId("");
            resetPage();
          }}
        />
        <ChoiceField
          label={m.stage}
          value={stageId}
          options={[
            { value: "", label: m.allStages },
            ...(type?.stages ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
          disabled={locked || !typeId}
          onChange={(value) => {
            setStageId(value);
            resetPage();
          }}
        />
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search.trim());
            resetPage();
          }}
        >
          <Input
            aria-label={m.search}
            placeholder={m.search}
            value={search}
            disabled={locked}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button variant="outline" disabled={locked} type="submit">
            {m.searchAction}
          </Button>
        </form>
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            label={m.showArchived}
            checked={archived}
            disabled={locked}
            onCheckedChange={(value) => {
              setArchived(value);
              resetPage();
            }}
          />
          {m.showArchived}
        </div>
      </div>
      <div className="flex justify-between gap-3">
        <div className="flex gap-2">
          <Button
            variant={board ? "default" : "outline"}
            disabled={locked}
            onClick={() => setBoard(true)}
          >
            {m.board}
          </Button>
          <Button
            variant={board ? "outline" : "default"}
            disabled={locked}
            onClick={() => setBoard(false)}
          >
            {m.list}
          </Button>
        </div>
        <Button
          variant="outline"
          disabled={locked}
          onClick={() => {
            resetPage();
            if (cursor === null) void records.reload();
          }}
        >
          {c.refresh}
        </Button>
      </div>
      <CommandFeedback
        state={command}
        retry={() => {
          void command.retry().then(accept);
        }}
        discard={command.discard}
        cancel={() => {
          void command.cancel().then(accept);
        }}
      />
      {records.error !== null ? <ProfileError code={records.error} /> : null}
      {options.error !== null ? <ProfileError code={options.error} /> : null}
      {records.loading ? (
        <p role="status">{c.loading}</p>
      ) : (
        <WorkRecords
          items={items}
          types={data.workTypes}
          typeId={typeId}
          board={board}
          disabled={locked || options.data === null}
          canMove={data.permissions.change}
          edit={(item) => setEditing({ item })}
          move={(item, stageId) => {
            void command
              .run({
                action: "update_item",
                requestId: crypto.randomUUID(),
                id: item.id,
                expectedRevision: item.revision,
                item: { ...draftForItem(item), stageId },
              })
              .then(accept);
          }}
        />
      )}
      {nextCursor !== null ? (
        <Button
          variant="outline"
          disabled={locked}
          onClick={() => {
            setPrevious(all);
            setCursor(nextCursor);
          }}
        >
          {m.loadMore}
        </Button>
      ) : null}
      {editing !== null && options.data !== null ? (
        <ItemEditor
          item={editing.item}
          types={data.workTypes}
          options={options.data}
          actorId={actorId}
          typeId={typeId}
          scope={scope}
          changed={accept}
          close={() => setEditing(null)}
          canChange={editing.item === null ? data.permissions.create : data.permissions.change}
        />
      ) : null}
    </div>
  );
}
