"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { WorkflowOwnerQuery } from "./useWorkflowOwnerQuery";

export function WorkflowOwnerFilter({
  value,
  selectedName,
  onChange,
  query,
}: {
  value: string | undefined;
  selectedName?: string;
  onChange: (id: string | undefined) => void;
  query: WorkflowOwnerQuery;
}) {
  const t = useAppTranslations("workflows");
  const id = useId();
  const { search, changeSearch, rows, retrying, retryError, retry, denied } = query;
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
          onChange={(event) => changeSearch(event.target.value)}
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
          onClick={query.more}
        >
          {t("libraryMoreOwners")}
        </Button>
      )}
    </div>
  );
}
