"use client";

import { ArrowDownUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { EditorSelect } from "../../ui/AssetEditorFields";
import type { AssetWords } from "../../ui/assetMessages";
import {
  type AssetRegisterSort,
  assetRegisterSortableColumns,
  maxAssetRegisterSortColumns,
} from "../contracts";
import type { DiscoveryWords } from "./messages";

export function AssetRegisterSortMenu({
  sort,
  change,
  assetWords,
  words: t,
}: {
  sort: AssetRegisterSort;
  change: (next: AssetRegisterSort) => void;
  assetWords: AssetWords;
  words: DiscoveryWords;
}) {
  const unused = assetRegisterSortableColumns.filter(
    (column) => !sort.some((criterion) => criterion.column === column),
  );
  const next = unused[0];
  const order = [
    { label: t.ascending, value: "asc" },
    { label: t.descending, value: "desc" },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" data-asset-sort-menu>
          <ArrowDownUp size={14} aria-hidden="true" /> {t.sort}
          {sort.length > 0 && <span aria-hidden="true">{sort.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={`${BLOCK_CLASS} ph-no-capture w-[min(24rem,calc(100vw-2rem))] space-y-2`}
      >
        {sort.map((criterion, index) => (
          <div
            key={criterion.column}
            data-asset-sort-row={index + 1}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2"
          >
            <EditorSelect
              label={`${t.sortColumn} ${index + 1}`}
              value={criterion.column}
              options={assetRegisterSortableColumns
                .filter((candidate) => candidate === criterion.column || unused.includes(candidate))
                .map((value) => ({ value, label: assetWords[value] }))}
              onChange={(value) => {
                const column = assetRegisterSortableColumns.find(
                  (candidate) => candidate === value,
                );
                if (column !== undefined)
                  change(sort.map((item, i) => (i === index ? { ...item, column } : item)));
              }}
            />
            <EditorSelect
              label={`${t.direction} ${index + 1}`}
              value={criterion.direction}
              options={order}
              onChange={(value) =>
                change(
                  sort.map((item, i) =>
                    i === index ? { ...item, direction: value === "desc" ? "desc" : "asc" } : item,
                  ),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${t.removeSort} ${index + 1}`}
              onClick={() => change(sort.filter((_, i) => i !== index))}
            >
              <X size={14} aria-hidden="true" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {next !== undefined && sort.length < maxAssetRegisterSortColumns && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-asset-sort-add
              onClick={() => change([...sort, { column: next, direction: "asc" }])}
            >
              <Plus size={14} aria-hidden="true" /> {t.addSort}
            </Button>
          )}
          {sort.length > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => change([])}>
              {t.clearSort}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
