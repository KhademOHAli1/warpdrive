"use client";
import Link from "next/link";
import type React from "react";
import { Button, buttonVariants } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { BoardEmptyKind } from "./boardEmptyKind";

type DealsEmptyProps = {
  onClearFilters: () => void;
  // Reuse the toolbar's add-deal control wherever creation is available.
  addSlot: React.ReactNode;
} & (
  | { variant: "board"; kind: Exclude<BoardEmptyKind, "none"> }
  | { variant: "list" | "archived"; pipelineId: string; filtered: boolean }
);

const boardCopy = {
  empty: { title: "computed.boardEmptyTitle", body: "computed.boardEmptyBody" },
  filtered: { title: "computed.boardEmptyFilteredTitle", body: "computed.boardEmptyFilteredBody" },
  unsure: { title: "computed.boardEmptyUnsureTitle", body: "computed.boardEmptyUnsureBody" },
} as const;

const listCopy = {
  list: { title: "legacy.dealsList.emptyTitle", body: "legacy.dealsList.emptyBody" },
  archived: {
    title: "legacy.dealsList.emptyArchivedTitle",
    body: "legacy.dealsList.emptyArchivedBody",
  },
  filtered: {
    title: "legacy.dealsList.emptyFilteredTitle",
    body: "legacy.dealsList.emptyFilteredBody",
  },
} as const;

export function DealsEmpty(props: DealsEmptyProps): React.ReactNode {
  const t = useAppTranslations("sales");
  const { variant, onClearFilters, addSlot } = props;
  const copy =
    variant === "board" ? boardCopy[props.kind] : listCopy[props.filtered ? "filtered" : variant];
  const clearFilters = (
    <Button size="sm" variant="outline" onClick={onClearFilters}>
      {t(variant === "board" ? "computed.clearFilters" : "legacy.dealsList.emptyFilteredAction")}
    </Button>
  );

  let action = addSlot;
  if (variant === "board") {
    if (props.kind === "filtered") action = clearFilters;
    if (props.kind === "unsure")
      action = (
        <div className="flex items-center gap-2">
          {clearFilters}
          {addSlot}
        </div>
      );
  } else if (props.filtered) {
    action = clearFilters;
  } else if (variant === "archived") {
    action = (
      <Link href={`/pipeline/${props.pipelineId}`} className={buttonVariants({ size: "sm" })}>
        {t("legacy.dealsList.emptyArchivedAction")}
      </Link>
    );
  }

  return <EmptyState title={t(copy.title)} body={t(copy.body)} action={action} />;
}
