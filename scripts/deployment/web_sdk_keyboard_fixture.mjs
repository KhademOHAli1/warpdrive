/** A standalone keyboard-help control for the owned Web SDK browser fixture. */

const PROPS = `{
  title: string;
  description: string;
  closeLabel: string;
}`;
const TRIGGER = "data-web-sdk-keyboard-help-trigger";
const CONTENT = "data-web-sdk-keyboard-help-dialog";
const CLOSE = "data-web-sdk-keyboard-help-close";

const BASELINE = `"use client";

import { useId, useRef, useState } from "react";

export function KeyboardHelpFixture({ title, description, closeLabel }: ${PROPS}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div>
      <button type="button" ref={trigger} aria-haspopup="dialog" aria-expanded={open}
        ${TRIGGER}="true" onClick={() => setOpen(true)} onKeyDown={(event) => {
          if (open && event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}>{title}</button>
      {open && (
        <section role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={descriptionId}
          ${CONTENT}="true">
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
          <button type="button" ${CLOSE}="true"
            onClick={() => close()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}>{closeLabel}</button>
        </section>
      )}
    </div>
  );
}
`;

const SDK = `"use client";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@ui-sdk/react/dialog";

export function KeyboardHelpFixture({ title, description, closeLabel }: ${PROPS}) {
  return (
    <Dialog>
      <DialogTrigger type="button" ${TRIGGER}="true">{title}</DialogTrigger>
      <DialogContent ${CONTENT}="true">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <DialogClose type="button" ${CLOSE}="true">{closeLabel}</DialogClose>
      </DialogContent>
    </Dialog>
  );
}
`;

export function fixtureSource({ sdk }) {
  if (typeof sdk !== "boolean")
    throw new TypeError("Select the baseline or SDK fixture explicitly");
  return sdk ? SDK : BASELINE;
}

export function fixtureAdapterSource() {
  return `import { KeyboardHelpFixture } from "./KeyboardHelpFixture";

export function KeyboardHelpFixtureAdapter() {
  return <KeyboardHelpFixture title="Keyboard shortcuts"
    description="Use Control or Command plus K to open workspace search."
    closeLabel="Close keyboard shortcuts" />;
}
`;
}

function requireProof(condition) {
  if (!condition) throw new Error("Required SDK keyboard-help browser evidence is unavailable");
}

async function readFocus(page, locator, timeout) {
  const handle = await locator.elementHandle({ timeout });
  try {
    await page.waitForFunction((element) => document.activeElement === element, handle, {
      timeout,
    });
  } finally {
    await handle.dispose();
  }
}

/**
 * The caller owns the page and, for a rollout, verifies its generation and session first.
 * Use only keyboard input, and never move focus by script after opening.
 */
export async function verifySdkKeyboardHelp(
  page,
  {
    triggerName = "Keyboard shortcuts",
    title = triggerName,
    closeName = "Close keyboard shortcuts",
    timeout = 5000,
  } = {},
) {
  requireProof(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 15000);
  const trigger = page
    .getByRole("button", { name: triggerName, exact: true })
    .and(page.locator(`[${TRIGGER}="true"]`));
  const panel = page.locator(`[${CONTENT}="true"]`);
  const dialog = page.getByRole("dialog", { name: title, exact: true }).and(panel);
  const close = dialog
    .getByRole("button", { name: closeName, exact: true })
    .and(page.locator(`[${CLOSE}="true"]`));

  const url = page.url();
  const documentRoot = await page.locator("html").elementHandle({ timeout });
  try {
    await trigger.waitFor({ state: "visible", timeout });
    await panel.waitFor({ state: "hidden", timeout });
    requireProof((await trigger.getAttribute("aria-haspopup", { timeout })) === "dialog");
    await trigger.focus({ timeout });
    await readFocus(page, trigger, timeout);

    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "visible", timeout });
    requireProof((await dialog.getAttribute("aria-modal", { timeout })) === "true");
    await readFocus(page, close, timeout);
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden", timeout });
    await readFocus(page, trigger, timeout);

    await page.keyboard.press("Space");
    await dialog.waitFor({ state: "visible", timeout });
    await readFocus(page, close, timeout);
    await page.keyboard.press("Enter");
    await panel.waitFor({ state: "hidden", timeout });
    await readFocus(page, trigger, timeout);
    requireProof(
      page.url() === url &&
        (await documentRoot.evaluate((element) => element === document.documentElement)),
    );

    return {
      openedByKeyboard: true,
      escapeClosed: true,
      focusRestored: true,
      closeButtonWorked: true,
      sameDocument: true,
    };
  } finally {
    await documentRoot.dispose();
  }
}
