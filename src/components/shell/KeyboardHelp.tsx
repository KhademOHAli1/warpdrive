"use client";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import styles from "./KeyboardHelp.module.css";

export function KeyboardHelp({
  title,
  description,
  closeLabel,
}: {
  title: string;
  description: string;
  closeLabel: string;
}) {
  return (
    <Dialog>
      <DialogTrigger
        type="button"
        className={styles.trigger}
        aria-label={title}
        data-web-sdk-keyboard-help-trigger="true"
      >
        <span aria-hidden="true">?</span>
      </DialogTrigger>
      <DialogContent
        className="fixed inset-0 z-50 grid place-items-center overflow-auto p-4"
        data-web-sdk-keyboard-help-dialog="true"
      >
        <div aria-hidden="true" className="absolute inset-0 bg-black opacity-40" />
        <div className="relative w-full max-w-xs rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-border">
          <div className={styles.panel}>
            <DialogTitle className={styles.heading}>{title}</DialogTitle>
            <DialogDescription className={styles.description}>{description}</DialogDescription>
            <DialogClose
              type="button"
              className={styles.close}
              data-web-sdk-keyboard-help-close="true"
            >
              {closeLabel}
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
