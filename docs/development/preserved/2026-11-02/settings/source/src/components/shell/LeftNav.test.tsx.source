// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DOCS_SITE_URL } from "@/constants/docs";
import { LeftNav } from "./LeftNav";
import styles from "./LeftNav.module.css";

// LeftNav reads the current path via usePathname to mark the active item; mock it so the
// component renders outside an app-router provider.
vi.mock("next/navigation", () => ({ usePathname: () => "/pipeline" }));

// The collapse preference now persists in a cookie (so the server can read it and render the
// correct width, avoiding the reload flash). jsdom provides a working document.cookie; clear it
// between tests. Reset to a clean jar by expiring the key.
function clearNavCookie(): void {
  document.cookie = "wd_nav_expanded=; path=/; max-age=0";
}

// jsdom has no matchMedia; shim it so the responsive default (expanded on wide screens, collapsed
// on small) can be exercised. `setViewport(true)` = wide (min-width query matches).
let mediaMatches = true;
function setViewport(wide: boolean): void {
  mediaMatches = wide;
}
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: /min-width/.test(query) ? mediaMatches : !mediaMatches,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
}));

afterEach(() => {
  cleanup();
  clearNavCookie();
  mediaMatches = true;
});

describe("LeftNav", () => {
  test.each([true, false])(
    "orders daily destinations before utilities (expanded: %s)",
    (expanded) => {
      setViewport(expanded);
      render(<LeftNav />);
      const navigation = screen.getByRole("navigation", { name: "Primary" });
      expect(
        within(navigation)
          .getAllByRole("link")
          .map((link) => link.getAttribute("href")),
      ).toEqual([
        "/pipeline",
        "/activities",
        "/inbox",
        "/leads",
        "/contacts/people",
        "/dashboard",
        "/workflows",
        "/settings",
        DOCS_SITE_URL,
      ]);
    },
  );

  test.each([true, false])("keeps the logo as a Home link (expanded: %s)", (expanded) => {
    setViewport(expanded);
    render(<LeftNav />);
    const home = screen.getByRole("link", { name: "Warpdrive home" });
    expect(home.getAttribute("href")).toBe("/pipeline");
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(home);
    expect(
      screen.getByRole("button", { name: expanded ? "Collapse sidebar" : "Expand sidebar" }),
    ).not.toBeNull();
  });

  test("server render honors initialExpanded so the width is correct at first paint (no reload flash)", () => {
    // The flash was caused by the server always rendering collapsed (localStorage is not readable
    // during SSR) and the client correcting to expanded post-mount, animating the width. With the
    // persisted state passed in as initialExpanded, the server render already reflects it, so there
    // is nothing to correct and nothing to animate.
    expect(renderToStaticMarkup(<LeftNav initialExpanded />)).toContain(
      'data-sidebar-state="expanded"',
    );
    expect(renderToStaticMarkup(<LeftNav initialExpanded={false} />)).toContain(
      'data-sidebar-state="collapsed"',
    );
  });

  test("renders all primary destinations as links with a navigation landmark", () => {
    render(<LeftNav />);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pipeline" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
  });

  test("labels the stats destination 'Performance', not 'Dashboard'", () => {
    render(<LeftNav />);
    expect(screen.getByRole("link", { name: "Performance" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
  });

  test("marks the active section with aria-current", () => {
    render(<LeftNav />);
    expect(screen.getByRole("link", { name: "Pipeline" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Contacts" }).getAttribute("aria-current")).toBeNull();
  });

  test("each destination shows a decorative icon (Pipedrive-style icon+label nav)", () => {
    render(<LeftNav />);
    const links = within(screen.getByRole("navigation", { name: "Primary" })).getAllByRole("link");
    // Every link carries an icon, and icons are aria-hidden so the accessible
    // name stays the label text.
    for (const link of links) {
      expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
    expect(links.length).toBeGreaterThan(0);
  });

  test("defaults to expanded on a wide screen (no stored preference)", () => {
    setViewport(true);
    render(<LeftNav />);
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).not.toBeNull();
    expect(screen.getByText("Pipeline").getAttribute("aria-hidden")).toBe("false");
  });

  test("defaults to the collapsed rail on a small screen (no stored preference)", () => {
    setViewport(false);
    render(<LeftNav />);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).not.toBeNull();
    expect(screen.getByText("Pipeline").getAttribute("aria-hidden")).toBe("true");
  });

  test("collapses to icons and expands to full labels via a toggle button", () => {
    // Start collapsed (small screen), then toggle expands.
    setViewport(false);
    render(<LeftNav />);
    const toggle = screen.getByRole("button", { name: "Expand sidebar" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Pipeline").getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(toggle);
    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Pipeline").getAttribute("aria-hidden")).toBe("false");
  });

  test("an explicit expand preference overrides the small-screen default across mounts", () => {
    // Small screen would default collapsed, but the user's stored choice wins.
    setViewport(false);
    const first = render(<LeftNav />);
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    first.unmount();

    render(<LeftNav />);
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).not.toBeNull();
    expect(screen.getByText("Settings").getAttribute("aria-hidden")).toBe("false");
  });

  test("an explicit collapse preference overrides the wide-screen default across mounts", () => {
    // Wide screen would default expanded, but a stored collapse choice wins.
    setViewport(true);
    const first = render(<LeftNav />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    first.unmount();

    render(<LeftNav />);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).not.toBeNull();
    expect(screen.getByText("Settings").getAttribute("aria-hidden")).toBe("true");
  });

  test("keeps collapsed destinations named while hiding their duplicate inline labels", () => {
    setViewport(false);
    render(<LeftNav />);

    // Collapsed links remain named, while their inline copies leave the accessibility tree.
    for (const link of within(screen.getByRole("navigation", { name: "Primary" })).getAllByRole(
      "link",
    )) {
      const label = link.querySelector('[data-sidebar-copy-state="collapsed"]');
      expect(label).not.toBeNull();
    }
  });
});

describe("LeftNav bracket shortcuts", () => {
  test("] collapses an expanded rail", () => {
    setViewport(true);
    render(<LeftNav />);
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.getByRole("button", { name: "Expand sidebar" })).not.toBeNull();
  });

  test("[ expands a collapsed rail", () => {
    setViewport(false);
    render(<LeftNav />);
    fireEvent.keyDown(window, { key: "[" });
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).not.toBeNull();
  });

  test("[ on an already expanded rail leaves it expanded", () => {
    setViewport(true);
    render(<LeftNav />);
    fireEvent.keyDown(window, { key: "[" });
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).not.toBeNull();
  });

  test("the bracket choice persists across mounts like the toggle button", () => {
    setViewport(true);
    const first = render(<LeftNav />);
    fireEvent.keyDown(window, { key: "]" });
    first.unmount();

    render(<LeftNav />);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).not.toBeNull();
  });

  test("does not fire while typing in a text field", () => {
    setViewport(true);
    render(<LeftNav />);
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "]" });
    input.remove();
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).not.toBeNull();
  });

  test("does not fire while a dialog is open", () => {
    setViewport(true);
    render(<LeftNav />);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: "]" });
    dialog.remove();
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).not.toBeNull();
  });

  test("links to the docs site in a new tab", () => {
    setViewport(true);
    render(<LeftNav />);
    const docs = screen.getByRole("link", { name: "Help & docs" });
    expect(docs.getAttribute("href")).toBe(DOCS_SITE_URL);
    expect(docs.getAttribute("target")).toBe("_blank");
    expect(docs.getAttribute("rel")).toContain("noreferrer");
  });

  test("keeps Settings, Help and the collapse control together below daily work", () => {
    setViewport(true);
    render(<LeftNav />);
    const navigation = screen.getByRole("navigation", { name: "Primary" });
    const footer = navigation.querySelector(`.${styles.utilityNav}`);
    expect(footer).not.toBeNull();
    expect(
      within(footer as HTMLElement)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Settings", "Help & docs"]);
    const docs = screen.getByRole("link", { name: "Help & docs" });
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(footer?.contains(toggle)).toBe(true);
    expect(docs.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("keeps an accessible name for the docs link on the collapsed rail", () => {
    setViewport(false);
    render(<LeftNav />);
    expect(screen.getByRole("link", { name: "Help & docs" })).not.toBeNull();
  });
});

describe("sidebar submenu behavior", () => {
  test.each(["Contacts", "Activities"])(
    "the first %s label click navigates without expanding",
    (label) => {
      setViewport(true);
      render(<LeftNav />);
      let prevented = true;
      document.addEventListener(
        "click",
        (event) => {
          prevented = event.defaultPrevented;
          event.preventDefault();
        },
        { once: true },
      );
      fireEvent.click(screen.getByRole("link", { name: label }));
      expect(prevented).toBe(false);
      expect(
        screen
          .getByRole("button", { name: `Expand ${label} navigation` })
          .getAttribute("aria-expanded"),
      ).toBe("false");
    },
  );

  test("the Contacts arrow separately reveals and hides children", () => {
    setViewport(true);
    render(<LeftNav />);
    fireEvent.click(screen.getByRole("button", { name: "Expand Contacts navigation" }));
    expect(
      screen
        .getByRole("button", { name: "Collapse Contacts navigation" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByRole("link", { name: "People" }).getAttribute("href")).toBe(
      "/contacts/people",
    );
    expect(screen.getByRole("link", { name: "Organizations" }).getAttribute("href")).toBe(
      "/contacts/orgs",
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse Contacts navigation" }));
    expect(screen.queryByRole("link", { name: "People" })).toBeNull();
  });
});
