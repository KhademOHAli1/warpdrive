"use client";

import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { cn } from "@/lib/utils";
import styles from "./WorkflowNodeCard.module.css";
import { WorkflowReferenceIcon } from "./WorkflowReferenceIcon";

export function WorkflowNodeOptions({
  trigger,
  onChangeType,
  onDuplicate,
  onRemove,
}: {
  trigger: boolean;
  onChangeType?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const canRemove = !trigger && onRemove !== undefined;
  const canDuplicate = !trigger && onDuplicate !== undefined;
  if (onChangeType === undefined && !canRemove && !canDuplicate) return null;
  return (
    <div className={cn("nodrag nopan", styles.options)}>
      <DropdownMenu dir={directionForLocale(locale)}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            static
            aria-label={t("nodeOptions")}
            className={styles.optionsButton}
            onClick={(event) => event.stopPropagation()}
          >
            <WorkflowReferenceIcon name="dots-vertical" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={8}
          className={cn("workflow-twenty-theme", styles.optionsMenu)}
          onClick={(event) => event.stopPropagation()}
        >
          {onChangeType !== undefined && (
            <DropdownMenuItem className={styles.option} onSelect={onChangeType}>
              <WorkflowReferenceIcon name="pencil" />
              {t("nodeChange")}
            </DropdownMenuItem>
          )}
          {canDuplicate && (
            <DropdownMenuItem className={styles.option} onSelect={onDuplicate}>
              <WorkflowReferenceIcon name="copy-plus" />
              {t("nodeDuplicate")}
            </DropdownMenuItem>
          )}
          {canRemove && (
            <DropdownMenuItem
              className={cn(styles.option, styles.removeOption)}
              onSelect={onRemove}
            >
              <WorkflowReferenceIcon name="trash" />
              {t("nodeDelete")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
