// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { workspaceNavItems } from "@/constants/workspaceNavigation";

const NAV_ITEMS = workspaceNavItems([], false);

import { GlobalShortcuts } from "./GlobalShortcuts";

// Make a direct router bypass observable through the same URL effect as link navigation.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => window.history.pushState(null, "", href),
  }),
}));

function renderShortcuts() {
  render(
    <nav id="primary-navigation">
      {NAV_ITEMS.map((item) => (
        <a
          key={item.key}
          href={item.href}
          onClick={(event) => {
            event.preventDefault();
            window.history.pushState(null, "", item.href);
          }}
        >
          {item.href}
        </a>
      ))}
    </nav>,
  );
  return render(<GlobalShortcuts />);
}

beforeEach(() => {
  window.history.replaceState(null, "", "/inbox");
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("GlobalShortcuts number keys", () => {
  test.each([
    ["2", "/activities"],
    ["3", "/leads"],
    ["4", "/inbox"],
    ["5", "/contacts/people"],
    ["6", "/settings"],
    ["7", "/workflows"],
  ])("%s follows the visible sidebar order to %s", (key, href) => {
    renderShortcuts();
    const previousLength = window.history.length;
    fireEvent.keyDown(window, { key });
    expect(window.location.pathname).toBe(href);
    expect(window.history.length).toBe(previousLength + 1);
  });

  test("1 navigates to the first nav item", () => {
    renderShortcuts();
    fireEvent.keyDown(window, { key: "1" });
    expect(window.location.pathname).toBe(NAV_ITEMS[0]?.href);
  });

  test("4 navigates to the fourth nav item", () => {
    renderShortcuts();
    fireEvent.keyDown(window, { key: "4" });
    expect(window.location.pathname).toBe(NAV_ITEMS[3]?.href);
  });

  test.each([
    ["2", "/activities"],
    ["6", "/settings"],
  ])("%s respects document capture cancellation when leaving Inbox for %s", (key, href) => {
    const view = renderShortcuts();
    let blockedHref: string | null = null;
    const cancelNavigation = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (anchor === null || new URL(anchor.href).pathname === "/inbox") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      blockedHref = anchor.getAttribute("href");
    };
    document.addEventListener("click", cancelNavigation, true);
    try {
      // Prove the mounted guard blocks an ordinary link before exercising the shortcut.
      fireEvent.click(view.getByRole("link", { name: href }));
      expect(window.location.pathname).toBe("/inbox");
      expect(blockedHref).toBe(href);
      blockedHref = null;

      fireEvent.keyDown(window, { key });
      expect(window.location.pathname).toBe("/inbox");
      expect(blockedHref).toBe(href);
    } finally {
      document.removeEventListener("click", cancelNavigation, true);
    }

    // Closing the composer removes its guard, so the same shortcut can navigate again.
    fireEvent.keyDown(window, { key });
    expect(window.location.pathname).toBe(href);
  });

  test("a digit past the end of the nav navigates nowhere", () => {
    renderShortcuts();
    fireEvent.keyDown(window, { key: String(NAV_ITEMS.length + 1) });
    expect(window.location.pathname).toBe("/inbox");
  });

  test("does not fire while typing in a text field", () => {
    renderShortcuts();
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "2" });
    expect(window.location.pathname).toBe("/inbox");
  });

  test("does not fire while a dialog is open", () => {
    renderShortcuts();
    document.body.insertAdjacentHTML("beforeend", '<div role="dialog"></div>');
    fireEvent.keyDown(window, { key: "2" });
    expect(window.location.pathname).toBe("/inbox");
  });

  test("leaves Cmd+1 to the browser", () => {
    renderShortcuts();
    fireEvent.keyDown(window, { key: "1", metaKey: true });
    expect(window.location.pathname).toBe("/inbox");
  });

  test("accepts Persian/Arabic digits and leaves IME, shifted and modified input alone", () => {
    renderShortcuts();
    fireEvent.keyDown(window, { key: "۲" });
    expect(window.location.pathname).toBe(NAV_ITEMS[1]?.href);
    fireEvent.keyDown(window, { key: "٣" });
    expect(window.location.pathname).toBe(NAV_ITEMS[2]?.href);
    fireEvent.keyDown(window, { key: "۲", isComposing: true });
    fireEvent.keyDown(window, { key: "۲", keyCode: 229 });
    fireEvent.keyDown(window, { key: "۲", shiftKey: true });
    fireEvent.keyDown(window, { key: "۲", ctrlKey: true });
    fireEvent.keyDown(window, { key: "۲", altKey: true });
    expect(window.location.pathname).toBe("/leads");
  });

  test("unbinds on unmount", () => {
    const view = renderShortcuts();
    view.unmount();
    fireEvent.keyDown(window, { key: "1" });
    expect(window.location.pathname).toBe("/inbox");
  });
});
