// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DOCS_SITE_URL } from "@/constants/docs";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { LeftNav } from "./LeftNav";
import styles from "./LeftNav.module.css";
import { WorkspaceShellProvider } from "./WorkspaceShellProvider";

// LeftNav reads the current path via usePathname to mark the active item; mock it so the
// component renders outside an app-router provider.
const route = vi.hoisted(() => ({ pathname: "/pipeline" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

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
  route.pathname = "/pipeline";
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
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
        "/leads",
        "/inbox",
        "/contacts/people",
        ...(expanded ? ["/settings", "/workflows", DOCS_SITE_URL] : []),
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

  test.each([true, false])(
    "keeps the refined footer toggle below the links, separate from the Home header (expanded: %s)",
    (expanded) => {
      setViewport(expanded);
      render(<LeftNav />);
      const home = screen.getByRole("link", { name: "Warpdrive home" });
      const header = home.closest(`.${styles.sidebarTopbar}`);
      const toggle = screen.getByRole("button", {
        name: expanded ? "Collapse sidebar" : "Expand sidebar",
      });
      const navigation = screen.getByRole("navigation", { name: "Primary" });
      expect(header).not.toBeNull();
      expect(header?.contains(toggle)).toBe(false);
      expect(header?.contains(home)).toBe(true);
      expect(home.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(toggle.textContent?.trim()).toBe("");
      expect(toggle.querySelector("kbd")).toBeNull();
      expect(toggle.getAttribute("type")).toBe("button");
      expect(toggle.getAttribute("aria-expanded")).toBe(String(expanded));
      expect(toggle.getAttribute("aria-controls")).toBe("primary-navigation");
      expect(navigation.contains(toggle)).toBe(true);
      expect(navigation.querySelector(`.${styles.utilityNav}`)?.contains(toggle)).toBe(true);
      if (expanded) {
        const docs = screen.getByRole("link", { name: "Help & docs" });
        expect(
          docs.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
      expect(toggle.querySelector('svg[aria-hidden="true"][focusable="false"]')).not.toBeNull();
    },
  );

  test("supports keyboard activation in both directions and persists the footer control choice", async () => {
    const user = userEvent.setup();
    setViewport(true);
    const first = render(<LeftNav />);
    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    collapse.focus();
    expect(document.activeElement).toBe(collapse);
    await user.keyboard("{Enter}");
    const expand = screen.getByRole("button", { name: "Expand sidebar" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(document.cookie).toContain("wd_nav_expanded=0");
    expect(
      screen
        .getByRole("navigation", { name: "Primary" })
        .querySelector('a[href="/pipeline"] [data-sidebar-copy-state]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expand.focus();
    await user.keyboard(" ");
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(document.cookie).toContain("wd_nav_expanded=1");
    first.unmount();
    setViewport(false);
    render(<LeftNav />);
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).not.toBeNull();
    expect(
      screen
        .getByRole("navigation", { name: "Primary" })
        .querySelector('a[href="/pipeline"] [data-sidebar-copy-state]')
        ?.getAttribute("aria-hidden"),
    ).toBe("false");
  });

  test.each([true, false])(
    "keeps the Farsi footer toggle named with a decorative mirrored glyph (expanded: %s)",
    (expanded) => {
      setViewport(expanded);
      render(
        <LocaleProvider locale="fa">
          <LeftNav />
        </LocaleProvider>,
      );
      const toggle = screen.getByRole("button", {
        name: expanded ? "جمع کردن نوار کناری" : "باز کردن نوار کناری",
      });
      expect(toggle.textContent?.trim()).toBe("");
      expect(toggle.getAttribute("aria-expanded")).toBe(String(expanded));
      expect(toggle.getAttribute("aria-controls")).toBe("primary-navigation");
      const glyph = toggle.querySelector("svg");
      expect(glyph?.getAttribute("aria-hidden")).toBe("true");
      expect(glyph?.getAttribute("focusable")).toBe("false");
      expect(glyph?.getAttribute("data-rtl-mirror")).toBe("true");
      expect(toggle.closest(`.${styles.sidebarTopbar}`)).toBeNull();
      expect(toggle.closest(`.${styles.utilityNav}`)).not.toBeNull();
      expect(document.documentElement.dir).toBe("rtl");
    },
  );

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
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
  });

  test("uses Dashboard as the central destination without separate Pipeline or Performance links", () => {
    render(<LeftNav />);
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/pipeline");
    expect(screen.queryByRole("link", { name: "Pipeline" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Performance" })).toBeNull();
  });

  test("applies workspace branding and work module visibility to the combined rail", () => {
    render(
      <WorkspaceShellProvider
        brand={{
          displayName: "Fixture Company",
          iconUrl: null,
          accentColor: null,
          foregroundColor: "#ffffff",
        }}
        modules={["work", "contacts"]}
        canViewWork
      >
        <LeftNav />
      </WorkspaceShellProvider>,
    );
    expect(screen.getByRole("link", { name: "Fixture Company home" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Work" }).getAttribute("href")).toBe("/work");
    expect(screen.getByRole("link", { name: "Contacts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("link", { name: "Activities" })).toBeNull();
  });

  test("marks the active section with aria-current", () => {
    render(<LeftNav />);
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Contacts" }).getAttribute("aria-current")).toBeNull();
  });

  test("keeps Dashboard active when viewing Performance through the dashboard selector", () => {
    route.pathname = "/dashboard";
    render(<LeftNav />);
    const navigation = screen.getByRole("navigation", { name: "Primary" });
    const dashboard = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboard.getAttribute("aria-current")).toBe("page");
    expect(dashboard.getAttribute("href")).toBe("/pipeline");
    expect(navigation.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Performance" })).toBeNull();
  });

  test.each([true, false])(
    "separates five daily destinations from Settings, Workflows and Help (expanded: %s)",
    (expanded) => {
      setViewport(expanded);
      render(<LeftNav />);
      const navigation = screen.getByRole("navigation", { name: "Primary" });
      const workspace = navigation.querySelector(`.${styles.workspaceNav}`);
      const footer = navigation.querySelector(`.${styles.utilityNav}`);
      expect(workspace).not.toBeNull();
      expect(footer).not.toBeNull();
      expect(
        within(workspace as HTMLElement)
          .getAllByRole("link")
          .map((link) => link.getAttribute("href")),
      ).toEqual(["/pipeline", "/activities", "/leads", "/inbox", "/contacts/people"]);
      expect(
        within(footer as HTMLElement)
          .queryAllByRole("link")
          .map((link) => link.getAttribute("href")),
      ).toEqual(expanded ? ["/settings", "/workflows", DOCS_SITE_URL] : []);
    },
  );

  test.each([
    { locale: "de", label: "Dashboard" },
    { locale: "fa", label: "داشبورد" },
  ] as const)("names the central dashboard in $locale", ({ locale, label }) => {
    render(
      <LocaleProvider locale={locale}>
        <LeftNav />
      </LocaleProvider>,
    );
    expect(screen.getByRole("link", { name: label }).getAttribute("href")).toBe("/pipeline");
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
    expect(screen.getByText("Dashboard").getAttribute("aria-hidden")).toBe("false");
  });

  test("defaults to the collapsed rail on a small screen (no stored preference)", () => {
    setViewport(false);
    render(<LeftNav />);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).not.toBeNull();
    expect(screen.getByText("Dashboard").getAttribute("aria-hidden")).toBe("true");
  });

  test("collapses to icons and expands to full labels via a toggle button", () => {
    // Start collapsed (small screen), then toggle expands.
    setViewport(false);
    render(<LeftNav />);
    const toggle = screen.getByRole("button", { name: "Expand sidebar" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Dashboard").getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(toggle);
    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Dashboard").getAttribute("aria-hidden")).toBe("false");
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
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
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

  test("keeps only Settings, Workflows and Help in the utility footer below daily work", () => {
    setViewport(true);
    render(<LeftNav />);
    const navigation = screen.getByRole("navigation", { name: "Primary" });
    const footer = navigation.querySelector(`.${styles.utilityNav}`);
    expect(footer).not.toBeNull();
    expect(
      within(footer as HTMLElement)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Settings", "Workflows", "Help & docs"]);
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(footer?.contains(toggle)).toBe(true);
    expect(within(footer as HTMLElement).getAllByRole("button")).toHaveLength(1);
    expect(navigation.contains(toggle)).toBe(true);
  });

  test("removes utility links from the collapsed rail and restores them when opened", async () => {
    const user = userEvent.setup();
    setViewport(false);
    render(<LeftNav />);
    const footer = screen
      .getByRole("navigation", { name: "Primary" })
      .querySelector(`.${styles.utilityNav}`) as HTMLElement;
    expect(footer.querySelectorAll("a")).toHaveLength(0);
    const opener = within(footer).getByRole("button", { name: "Expand sidebar" });
    opener.focus();
    await user.keyboard("{Enter}");
    expect(
      within(footer)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Settings", "Workflows", "Help & docs"]);
    expect(document.activeElement).toBe(
      within(footer).getByRole("button", { name: "Collapse sidebar" }),
    );
    await user.keyboard("{Enter}");
    expect(footer.querySelectorAll("a")).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
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
