"use client";

import { Children, isValidElement, type ReactNode, type Ref } from "react";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { WorkflowReferenceIcon } from "./WorkflowReferenceIcon";
import styles from "./workflowEditor.module.css";

export function WorkflowEditorMenu({
  children,
  triggerRef,
}: {
  children: ReactNode;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const t = useAppTranslations("workflows");
  const items = Children.toArray(children).filter(isValidElement<{ disabled?: boolean }>);
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="outline"
          size="icon"
          aria-label={t("workflowOptions")}
          className={styles.moreButton}
        >
          <WorkflowReferenceIcon name="dots-vertical" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={`workflow-twenty-theme ${styles.menu}`}
        align="end"
        sideOffset={8}
      >
        {items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            asChild
            disabled={item.props.disabled}
            className={styles.menuItem}
          >
            {item}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
