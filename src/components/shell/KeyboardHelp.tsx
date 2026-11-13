"use client";

import { useId, useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="relative">
      <button
        type="button"
        className={styles.trigger}
        ref={trigger}
        aria-label={title}
        aria-expanded={open}
        aria-controls={panelId}
        data-web-sdk-keyboard-help-trigger="true"
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (open && event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      >
        <span aria-hidden="true">?</span>
      </button>
      <section
        id={panelId}
        hidden={!open}
        aria-labelledby={titleId}
        className="absolute end-0 top-full z-50 mt-2 w-52 rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-border"
        data-web-sdk-keyboard-help-dialog="true"
      >
        <div className={styles.panel}>
          <h2 id={titleId} className={styles.heading}>
            {title}
          </h2>
          <p className={styles.description}>{description}</p>
          <button
            type="button"
            className={styles.close}
            data-web-sdk-keyboard-help-close="true"
            onClick={() => close()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
          >
            {closeLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
