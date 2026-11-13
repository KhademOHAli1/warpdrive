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
        className="fixed top-0 right-0 bottom-0 left-0 z-50 m-auto h-fit max-h-screen w-full max-w-72 overflow-auto rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-border"
        data-web-sdk-keyboard-help-dialog="true"
      >
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
      </DialogContent>
    </Dialog>
  );
}
