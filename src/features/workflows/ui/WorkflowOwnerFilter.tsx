"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import type { WorkflowOwnersInput, WorkflowOwnersPage } from "../library";
import { libraryReadDenied, libraryRefetchFailed } from "./libraryErrors";

export function WorkflowOwnerFilter({
  archive,
  value,
  selectedName,
  onChange,
  onDenied,
}: {
  archive: "current" | "archived";
  value: string | undefined;
  selectedName?: string;
  onChange: (id: string | undefined) => void;
  onDenied: () => void;
}) {
  const t = useAppTranslations("workflows");
  const id = useId();
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [rows, setRows] = useState<WorkflowOwnersPage["items"]>([]);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const denialReported = useRef(false);
  const input: WorkflowOwnersInput = {
    archive,
    query: search.trim(),
    limit: 25,
    ...(cursor === undefined ? {} : { cursor }),
  };
  const query = trpc.workflows.owners.useQuery(input);
  const denied = query.isError && libraryReadDenied(query.error);

  useEffect(() => {
    if (!denied || denialReported.current) return;
    denialReported.current = true;
    setRows([]);
    setCursor(undefined);
    onDenied();
  }, [denied, onDenied]);

  useEffect(() => {
    if (query.data === undefined || denied) return;
    const incoming = query.data.items;
    setRows((previous) =>
      cursor === undefined
        ? incoming
        : [
            ...previous,
            ...incoming.filter((owner) => !previous.some((old) => old.id === owner.id)),
          ],
    );
  }, [query.data, cursor, denied]);

  async function retry() {
    if (retrying || query.isFetching) return;
    setRetrying(true);
    setRetryError(false);
    try {
      if (libraryRefetchFailed(await query.refetch())) setRetryError(true);
    } catch {
      setRetryError(true);
    } finally {
      setRetrying(false);
    }
  }

  const selected =
    value !== undefined && !rows.some((owner) => owner.id === value)
      ? [{ value, label: selectedName ?? t("librarySelectedOwner") }]
      : [];
  const options = [
    { value: "", label: t("libraryAllOwners") },
    ...selected,
    ...rows.map((owner) => ({ value: owner.id, label: owner.name })),
  ];
  if (denied) return <p role="alert">{t("denied")}</p>;
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <Select
        ariaLabel={t("libraryOwner")}
        value={value ?? ""}
        options={options}
        onChange={(owner) => onChange(owner === "" ? undefined : owner)}
      />
      <div className="space-y-2">
        <label htmlFor={id} className="text-xs text-muted-foreground">
          {t("libraryOwnerSearch")}
        </label>
        <Input
          id={id}
          type="search"
          dir="auto"
          maxLength={200}
          value={search}
          onChange={(event) => {
            const nextSearch = event.target.value;
            setSearch(nextSearch);
            if (nextSearch.trim() === search.trim()) return;
            setCursor(undefined);
            setRows([]);
            setRetryError(false);
          }}
        />
      </div>
      {(query.isLoading || query.isFetching) && (
        <p role="status" className="text-xs">
          {t("loading")}
        </p>
      )}
      {(query.isError || retryError) && (
        <div role="alert" className="space-y-2">
          <p>{t("libraryOwnersError")}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={query.isFetching || retrying}
            onClick={() => void retry()}
          >
            {t("retry")}
          </Button>
        </div>
      )}
      {!query.isError &&
        !retryError &&
        !query.isLoading &&
        !query.isFetching &&
        query.data !== undefined &&
        rows.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("libraryNoOwners")}</p>
        )}
      {query.data?.nextCursor !== null && query.data?.nextCursor !== undefined && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={query.isFetching || retrying}
          onClick={() => setCursor(query.data?.nextCursor ?? undefined)}
        >
          {t("libraryMoreOwners")}
        </Button>
      )}
    </div>
  );
}
