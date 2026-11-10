"use client";

import { Plus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageHeading } from "@/components/shell/PageHeading";
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
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useNewsletterRead, useNewsletterWrite } from "@/features/newsletter/ui/client";
import { useFormatters } from "@/lib/useFormatters";
import {
  AudiencePagination,
  AudienceRefresh,
  AudienceSearch,
  AudienceTable,
  AudienceWriteError,
} from "./components";
import type { AudiencePage, MailingList } from "./contracts";
import { useAudienceMessages } from "./messages";

function ListEditor({ row, close }: { row: MailingList | null; close: () => void }) {
  const L = useAudienceMessages();
  const prefix = useId();
  const [name, setName] = useState(row?.name ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [tags, setTags] = useState(row?.tags.join(", ") ?? "");
  const [type, setType] = useState<MailingList["type"]>(row?.type ?? "private");
  const [optin, setOptin] = useState<MailingList["optin"]>(row?.optin ?? "double");
  const [status, setStatus] = useState<MailingList["status"]>(row?.status ?? "active");
  const write = useNewsletterWrite();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === "" || write.isPending) return;
    const fields = {
      name,
      description,
      type,
      optin,
      status,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
    const command = row
      ? write.run("lists.update", { ...fields, id: row.id })
      : write.run("lists.create", fields);
    void command.then(close).catch(() => undefined);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !write.isPending) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row ? L.editList : L.newList}</DialogTitle>
          <DialogDescription>{L.listForm}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <label className="block space-y-1.5" htmlFor={`${prefix}-name`}>
            <span className="text-sm font-medium">{L.name}</span>
            <Input
              id={`${prefix}-name`}
              value={name}
              maxLength={200}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5" htmlFor={`${prefix}-description`}>
            <span className="text-sm font-medium">{L.description}</span>
            <Textarea
              id={`${prefix}-description`}
              value={description}
              maxLength={4000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{L.type}</p>
              <Select
                ariaLabel={L.type}
                value={type}
                onChange={(value) => setType(value as MailingList["type"])}
                options={[
                  { value: "private", label: L.private },
                  { value: "public", label: L.public },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{L.optin}</p>
              <Select
                ariaLabel={L.optin}
                value={optin}
                onChange={(value) => setOptin(value as MailingList["optin"])}
                options={[
                  { value: "single", label: L.single },
                  { value: "double", label: L.double },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{L.status}</p>
              <Select
                ariaLabel={L.status}
                value={status}
                onChange={(value) => setStatus(value as MailingList["status"])}
                options={[
                  { value: "active", label: L.active },
                  { value: "archived", label: L.archived },
                ]}
              />
            </div>
          </div>
          <label className="block space-y-1.5" htmlFor={`${prefix}-tags`}>
            <span className="text-sm font-medium">{L.tags}</span>
            <Input
              id={`${prefix}-tags`}
              value={tags}
              maxLength={3000}
              aria-describedby={`${prefix}-tags-hint`}
              onChange={(event) => setTags(event.target.value)}
            />
            <span id={`${prefix}-tags-hint`} className="block text-sm text-muted-foreground">
              {L.tagsHint}
            </span>
          </label>
          <AudienceWriteError error={write.error} />
          <DialogFooter>
            <Button variant="outline" disabled={write.isPending} onClick={close}>
              {L.cancel}
            </Button>
            <Button type="submit" disabled={write.isPending || name.trim() === ""}>
              {L.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ListFilters = {
  status?: MailingList["status"];
  type?: MailingList["type"];
  optin?: MailingList["optin"];
};

function ListFilterControls({
  filters,
  change,
}: {
  filters: ListFilters;
  change: (filters: ListFilters) => void;
}) {
  const L = useAudienceMessages();
  return (
    <>
      <Select
        ariaLabel={L.status}
        value={filters.status ?? ""}
        triggerClassName="w-auto min-w-32"
        onChange={(value) =>
          change({
            ...filters,
            status: value === "" ? undefined : (value as MailingList["status"]),
          })
        }
        options={[
          { value: "", label: L.all },
          { value: "active", label: L.active },
          { value: "archived", label: L.archived },
        ]}
      />
      <Select
        ariaLabel={L.type}
        value={filters.type ?? ""}
        triggerClassName="w-auto min-w-32"
        onChange={(value) =>
          change({ ...filters, type: value === "" ? undefined : (value as MailingList["type"]) })
        }
        options={[
          { value: "", label: L.all },
          { value: "private", label: L.private },
          { value: "public", label: L.public },
        ]}
      />
      <Select
        ariaLabel={L.optin}
        value={filters.optin ?? ""}
        triggerClassName="w-auto min-w-32"
        onChange={(value) =>
          change({ ...filters, optin: value === "" ? undefined : (value as MailingList["optin"]) })
        }
        options={[
          { value: "", label: L.all },
          { value: "single", label: L.single },
          { value: "double", label: L.double },
        ]}
      />
    </>
  );
}

export function ListsScreen() {
  const L = useAudienceMessages();
  const format = useFormatters();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ListFilters>({});
  const [editor, setEditor] = useState<{ row: MailingList | null } | null>(null);
  const [deleting, setDeleting] = useState<MailingList | null>(null);
  const read = useNewsletterRead<AudiencePage<MailingList>>("lists.page", {
    page,
    search,
    ...filters,
  });
  const write = useNewsletterWrite();
  const rows = read.data?.results ?? [];

  function remove() {
    if (!deleting) return;
    void write
      .run("lists.delete", { id: deleting.id })
      .then(() => setPage(1))
      .catch(() => undefined);
  }

  return (
    <section className="space-y-4">
      <PageHeading
        title={L.lists}
        actions={
          <Button onClick={() => setEditor({ row: null })}>
            <Plus className="size-4" aria-hidden="true" />
            {L.newList}
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
        <ListFilterControls
          filters={filters}
          change={(value) => {
            setFilters(value);
            setPage(1);
          }}
        />
        <AudienceRefresh read={read} />
      </div>
      <AudienceWriteError error={write.error} />
      <AudienceTable
        labels={[L.name, L.type, L.optin, L.status, L.subscribers, L.actions]}
        empty={L.emptyLists}
        read={read}
        count={rows.length}
      >
        {rows.map((row) => (
          <tr key={row.id} className="hover:bg-muted/30">
            <td className="min-w-48 space-y-1 px-4 py-3">
              <p className="font-medium">
                <bdi dir="auto">{row.name}</bdi>
              </p>
              {row.description && (
                <p className="line-clamp-2 max-w-80 break-words text-xs text-muted-foreground">
                  {row.description}
                </p>
              )}
              {row.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {row.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </td>
            <td className="px-4 py-3">{L[row.type]}</td>
            <td className="px-4 py-3">{L[row.optin]}</td>
            <td className="px-4 py-3">
              <Badge variant="secondary">{L[row.status]}</Badge>
            </td>
            <td className="px-4 py-3">{format.number(row.subscriber_count)}</td>
            <td className="px-4 py-3">
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditor({ row })}>
                  {L.edit}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={write.isPending}
                  onClick={() => setDeleting(row)}
                >
                  {L.delete}
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </AudienceTable>
      <AudiencePagination
        page={page}
        total={read.data?.total ?? 0}
        busy={read.isFetching}
        onPageChange={setPage}
      />
      {editor && <ListEditor row={editor.row} close={() => setEditor(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={L.deleteList}
        description={L.deleteListDetail}
        confirmLabel={L.delete}
        destructive
        pending={write.isPending}
        onConfirm={remove}
      />
    </section>
  );
}
