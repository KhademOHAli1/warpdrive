"use client";
import { Kanban, List, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ToggleField } from "@/components/ui/ToggleField";
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

const viewButton =
  "font-medium text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground";

export function WorkHub({ data, actorId }: { data: Overview; actorId: string }) {
  const m = useWorkMessages();
  const c = useCompanyMessages();
  const searchId = useId();
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
          <h1 className="text-display font-semibold">{m.hubTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{m.hubIntro}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.permissions.manageProfile || data.permissions.manage ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
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
      <div className="@container rounded-lg border bg-card">
        <div className="grid items-end gap-3 p-3 @xs:grid-cols-2 @3xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_max-content] sm:px-4">
          <form
            className="min-w-0 space-y-1.5 text-sm @xs:col-span-2 @3xl:col-span-1"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(search.trim());
              resetPage();
            }}
          >
            <label htmlFor={searchId} className="font-medium">
              {m.search}
            </label>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id={searchId}
                  className="h-8 ps-8"
                  type="search"
                  value={search}
                  disabled={locked}
                  maxLength={200}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" disabled={locked} type="submit">
                {m.searchAction}
              </Button>
            </div>
          </form>
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
          <ToggleField
            label={m.archivedOnly}
            className="min-h-8 justify-self-start gap-2 px-2 text-sm @xs:col-span-2 @3xl:col-span-1"
            checked={archived}
            disabled={locked}
            onCheckedChange={(value) => {
              setArchived(value);
              resetPage();
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 sm:px-4">
          <fieldset className="inline-flex min-w-0 max-w-full flex-wrap gap-0.5 rounded-lg border bg-muted/40 p-0.5">
            <legend className="sr-only">{m.viewMode}</legend>
            <Button
              variant="ghost"
              size="sm"
              static
              aria-pressed={board}
              className={viewButton}
              disabled={locked}
              onClick={() => setBoard(true)}
            >
              <Kanban aria-hidden="true" className="size-4" />
              {m.board}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              static
              aria-pressed={!board}
              className={viewButton}
              disabled={locked}
              onClick={() => setBoard(false)}
            >
              <List aria-hidden="true" className="size-4" />
              {m.list}
            </Button>
          </fieldset>
          <Button
            variant="ghost"
            size="sm"
            static
            aria-label={c.refresh}
            title={c.refresh}
            className="size-8 p-0 text-muted-foreground"
            disabled={locked}
            onClick={() => {
              resetPage();
              if (cursor === null) void records.reload();
            }}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
          </Button>
        </div>
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
