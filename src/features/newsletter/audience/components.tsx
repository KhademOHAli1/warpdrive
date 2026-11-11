"use client";

import { RefreshCw, Search } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { useFormatters } from "@/lib/useFormatters";
import { audiencePageSize, type MinimalList } from "./contracts";
import { useAudienceMessages } from "./messages";

type ReadState = {
  isLoading: boolean;
  isFetching: boolean;
  error: object | null;
  refetch: () => Promise<unknown>;
};

export function AudienceSearch({ onSearch }: { onSearch: (value: string) => void }) {
  const L = useAudienceMessages();
  const [value, setValue] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(value.trim());
  }

  return (
    <search className="min-w-48 flex-1">
      <form className="flex gap-2" onSubmit={submit}>
        <Input
          type="search"
          aria-label={L.search}
          placeholder={L.search}
          value={value}
          maxLength={200}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button variant="outline" type="submit">
          <Search className="size-4" aria-hidden="true" />
          {L.search}
        </Button>
      </form>
    </search>
  );
}

export function AudienceRefresh({ read }: { read: ReadState }) {
  const L = useAudienceMessages();
  return (
    <Button variant="outline" disabled={read.isFetching} onClick={() => void read.refetch()}>
      <RefreshCw className="size-4" aria-hidden="true" />
      {L.refresh}
    </Button>
  );
}

export function AudienceReadError({ read }: { read: ReadState }) {
  const L = useAudienceMessages();
  return (
    <div className="flex flex-wrap items-center gap-3 p-4 text-sm">
      <p role="alert" className="text-destructive">
        {L.loadError}
      </p>
      <AudienceRefresh read={read} />
    </div>
  );
}

export function AudienceTable({
  labels,
  leadingHeader,
  children,
  empty,
  read,
  count,
}: {
  labels: string[];
  leadingHeader?: ReactNode;
  children: ReactNode;
  empty: string;
  read: ReadState;
  count: number;
}) {
  const L = useAudienceMessages();
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            {leadingHeader !== undefined && (
              <th scope="col" className="w-12 px-4 py-3">
                {leadingHeader}
              </th>
            )}
            {labels.map((label) => (
              <th key={label} scope="col" className="px-4 py-3 text-start font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {children}
          {count === 0 && (
            <tr>
              <td colSpan={labels.length + (leadingHeader === undefined ? 0 : 1)}>
                {read.error !== null ? (
                  <AudienceReadError read={read} />
                ) : (
                  <p role="status" className="px-4 py-6 text-muted-foreground">
                    {read.isLoading ? L.loading : empty}
                  </p>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {count > 0 && read.error !== null && <AudienceReadError read={read} />}
    </div>
  );
}

export function AudiencePagination({
  page,
  total,
  onPageChange,
  busy,
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
  busy: boolean;
}) {
  const L = useAudienceMessages();
  const format = useFormatters();
  const last = Math.max(page, Math.ceil(total / audiencePageSize));
  if (last <= 1) return null;
  return (
    <nav aria-label={L.page} className="flex flex-wrap items-center justify-end gap-3">
      <span className="text-sm text-muted-foreground">
        {L.page} {format.number(page)} / {format.number(last)}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        {L.previous}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || page >= last}
        onClick={() => onPageChange(page + 1)}
      >
        {L.next}
      </Button>
    </nav>
  );
}

export function AudienceListPicker({
  lists,
  value,
  onChange,
  read,
}: {
  lists: MinimalList[];
  value: number[];
  onChange: (value: number[]) => void;
  read: ReadState;
}) {
  const L = useAudienceMessages();
  const prefix = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{L.selectLists}</legend>
      {read.error !== null && <AudienceReadError read={read} />}
      {read.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          {L.loading}
        </p>
      )}
      {!read.isLoading && read.error === null && lists.length === 0 && (
        <p className="text-sm text-muted-foreground">{L.noActiveLists}</p>
      )}
      {lists.length > 0 && (
        <div className="grid max-h-44 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
          {lists.map(({ id, name }) => (
            <label key={id} htmlFor={`${prefix}-${id}`} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`${prefix}-${id}`}
                checked={value.includes(id)}
                label={name}
                disabled={!value.includes(id) && value.length >= 100}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...value, id] : value.filter((item) => item !== id))
                }
              />
              <bdi dir="auto" className="break-all">
                {name}
              </bdi>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export function AudienceWriteError({ error }: { error: { message: string } | null }) {
  const L = useAudienceMessages();
  if (error === null) return null;
  const errors: Record<string, string> = {
    "Campaign delivery is disabled.": L.deliveryDisabled,
    audience_invalid_csv: L.invalidCsv,
    audience_no_pending_optin: L.optinUnavailable,
    audience_subscriber_changed: L.subscriberChanged,
    audience_export_unavailable: L.subscriberExportUnavailable,
  };
  return (
    <p role="alert" className="text-sm text-destructive">
      {errors[error.message] ?? L.writeError}
    </p>
  );
}
