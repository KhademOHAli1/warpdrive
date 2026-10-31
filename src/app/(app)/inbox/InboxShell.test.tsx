// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import styles from "@/features/email/inboxWorkspace.module.css";

// InboxShell is the persistent two-pane frame (rail | content) that the /inbox layout wraps every
// inbox route in. It renders the folder rail (a client component reading router hooks) beside the
// route's own content, so the rail is present on the list, reader, and compose routes alike.
let pathname = "/inbox";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    email: {
      inbox: { unreadCount: { useQuery: () => ({ data: 0 }) } },
    },
  },
}));

import { InboxShell } from "./InboxShell";

let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement("style");
  style.textContent = readFileSync("src/features/email/inboxWorkspace.module.css", "utf8").replace(
    /\.([a-zA-Z][\w-]*)/g,
    (selector, className: string) =>
      styles[className] === undefined ? selector : `.${styles[className]}`,
  );
  document.head.append(style);
});

afterEach(() => {
  cleanup();
  style.remove();
  pathname = "/inbox";
});

it("wraps its children with the folder rail on the reader route", () => {
  pathname = "/inbox/thread-1";
  render(
    <InboxShell newEmailEnabled={true}>
      <div data-testid="reader-content">a thread</div>
    </InboxShell>,
  );
  expect(screen.getByRole("navigation", { name: "Mail folders" })).toBeInTheDocument();
  expect(screen.getByTestId("reader-content")).toBeInTheDocument();
});

it("wraps its children with the folder rail on the compose route", () => {
  pathname = "/inbox/compose";
  render(
    <InboxShell newEmailEnabled={true}>
      <div data-testid="compose-content">a composer</div>
    </InboxShell>,
  );
  expect(screen.getByRole("navigation", { name: "Mail folders" })).toBeInTheDocument();
  expect(screen.getByTestId("compose-content")).toBeInTheDocument();
});

it("keeps the folder rail beside a shrinkable content track", () => {
  pathname = "/inbox/thread-1";
  render(
    <InboxShell newEmailEnabled={true}>
      <div data-testid="reader-content">a thread</div>
    </InboxShell>,
  );
  const nav = screen.getByRole("navigation", { name: "Mail folders" });
  const contentPane = screen.getByTestId("reader-content").parentElement;
  const folders = nav.parentElement;
  const shell = folders?.parentElement;
  const foldersClass = styles.folders;
  if (foldersClass === undefined) throw new Error("Inbox folder class is missing");
  expect(folders).toHaveClass(foldersClass);
  expect(shell).toBe(contentPane?.parentElement);
  expect(shell).toHaveStyle({ display: "grid", overflow: "hidden" });
  if (shell === null || shell === undefined) throw new Error("Inbox grid is missing");
  // The rail owns a fixed length; minmax lets the content track shrink below its contents.
  expect(getComputedStyle(shell).gridTemplateColumns).toMatch(
    /^\d+(?:\.\d+)?(?:rem|px) minmax\(0,\s*1fr\)$/,
  );
  expect(contentPane).toHaveStyle({ minWidth: "0", minHeight: "0" });
});
