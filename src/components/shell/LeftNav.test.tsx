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
  // biome-ignore lint/suspicious/noDocumentCookie: Reset the server-readable fixture preference.
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
        "/leads",
        "/inbox",
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
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: expanded })).not.toBeNull();
  });

  test.each([true, false])(
    "keeps the refined footer toggle below the links, separate from the Home header (expanded: %s)",
    (expanded) => {
      setViewport(expanded);
      render(<LeftNav />);
      const home = screen.getByRole("link", { name: "Warpdrive home" });
      const header = home.closest(`.${styles.sidebarTopbar}`);
      const toggle = screen.getByRole("button", {
        name: "Pin sidebar",
        pressed: expanded,
      });
      const navigation = screen.getByRole("navigation", { name: "Primary" });
      expect(header).not.toBeNull();
      expect(header?.contains(toggle)).toBe(false);
      expect(header?.contains(home)).toBe(true);
      expect(home.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(toggle.textContent?.trim()).toBe("");
      expect(toggle.querySelector("kbd")).toBeNull();
      expect(toggle.getAttribute("type")).toBe("button");
      expect(toggle.getAttribute("aria-pressed")).toBe(String(expanded));
      expect(toggle.hasAttribute("aria-expanded")).toBe(false);
      expect(toggle.getAttribute("aria-controls")).toBe("primary-navigation");
      expect(navigation.contains(toggle)).toBe(false);
      expect(toggle.closest(`.${styles.sidebarToggleDock}`)).not.toBeNull();
      expect(toggle.closest(`.${styles.utilityNav}`)).toBeNull();
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
    const collapse = screen.getByRole("button", { name: "Pin sidebar", pressed: true });
    collapse.focus();
    expect(document.activeElement).toBe(collapse);
    await user.keyboard("{Enter}");
    const expand = screen.getByRole("button", { name: "Pin sidebar", pressed: false });
    expect(expand.getAttribute("aria-pressed")).toBe("false");
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
      screen
        .getByRole("button", { name: "Pin sidebar", pressed: true })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.cookie).toContain("wd_nav_expanded=1");
    first.unmount();
    setViewport(false);
    render(<LeftNav />);
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: true })).not.toBeNull();
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
        name: "سنجاق کردن نوار کناری",
        pressed: expanded,
      });
      expect(toggle.textContent?.trim()).toBe("");
      expect(toggle.getAttribute("aria-pressed")).toBe(String(expanded));
      expect(toggle.hasAttribute("aria-expanded")).toBe(false);
      expect(toggle.getAttribute("aria-controls")).toBe("primary-navigation");
      const glyph = toggle.querySelector("svg");
      expect(glyph?.getAttribute("aria-hidden")).toBe("true");
      expect(glyph?.getAttribute("focusable")).toBe("false");
      expect(glyph?.getAttribute("data-rtl-mirror")).toBe("true");
      expect(toggle.closest(`.${styles.sidebarTopbar}`)).toBeNull();
      expect(toggle.closest(`.${styles.sidebarToggleDock}`)).not.toBeNull();
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
    expect(screen.getByRole("button", { name: "Contacts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("link", { name: "Activities" })).toBeNull();
  });

  test("marks the active section with aria-current", () => {
    render(<LeftNav />);
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      screen.getByRole("button", { name: "Contacts" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  test("keeps Dashboard active when viewing Performance through the dashboard selector", () => {
    route.pathname = "/dashboard";
    render(<LeftNav />);
    const navigation = screen.getByRole("navigation", { name: "Primary" });
    const dashboard = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboard.getAttribute("aria-current")).toBe("page");
    expect(dashboard.getAttribute("href")).toBe("/pipeline");
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
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
      expect(
        within(workspace as HTMLElement)
          .getAllByRole("link")
          .map((link) => link.getAttribute("href")),
      ).toEqual(["/pipeline", "/leads", "/inbox"]);
      if (expanded) {
        expect(footer).not.toBeNull();
        expect(
          within(footer as HTMLElement)
            .queryAllByRole("link")
            .map((link) => link.getAttribute("href")),
        ).toEqual(["/settings", "/workflows", DOCS_SITE_URL]);
      } else {
        expect(footer).toBeNull();
      }
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
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: true })).not.toBeNull();
    expect(screen.getByText("Dashboard").getAttribute("aria-hidden")).toBe("false");
  });

  test("defaults to the collapsed rail on a small screen (no stored preference)", () => {
    setViewport(false);
    render(<LeftNav />);
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: false })).not.toBeNull();
    expect(screen.getByText("Dashboard").getAttribute("aria-hidden")).toBe("true");
  });

  test("collapses to icons and expands to full labels via a toggle button", () => {
    // Start collapsed (small screen), then toggle expands.
    setViewport(false);
    render(<LeftNav />);
    const toggle = screen.getByRole("button", { name: "Pin sidebar", pressed: false });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Dashboard").getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(toggle);
    const collapse = screen.getByRole("button", { name: "Pin sidebar", pressed: true });
    expect(collapse.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Dashboard").getAttribute("aria-hidden")).toBe("false");
  });

  test("an explicit expand preference overrides the small-screen default across mounts", () => {
    // Small screen would default collapsed, but the user's stored choice wins.
    setViewport(false);
    const first = render(<LeftNav />);
    fireEvent.click(screen.getByRole("button", { name: "Pin sidebar", pressed: false }));
    first.unmount();

    render(<LeftNav />);
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: true })).not.toBeNull();
    expect(screen.getByText("Settings").getAttribute("aria-hidden")).toBe("false");
  });

  test("an explicit collapse preference overrides the wide-screen default across mounts", () => {
    // Wide screen would default expanded, but a stored collapse choice wins.
    setViewport(true);
    const first = render(<LeftNav />);
    fireEvent.click(screen.getByRole("button", { name: "Pin sidebar", pressed: true }));
    first.unmount();

    render(<LeftNav />);
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: false })).not.toBeNull();
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
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: false })).not.toBeNull();
  });

  test("[ expands a collapsed rail", () => {
    setViewport(false);
    render(<LeftNav />);
    fireEvent.keyDown(window, { key: "[" });
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: true })).not.toBeNull();
  });

  test("[ on an already expanded rail leaves it expanded", () => {
    setViewport(true);
    render(<LeftNav />);
    fireEvent.keyDown(window, { key: "[" });
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: true })).not.toBeNull();
  });

  test("the bracket choice persists across mounts like the toggle button", () => {
    setViewport(true);
    const first = render(<LeftNav />);
    fireEvent.keyDown(window, { key: "]" });
    first.unmount();

    render(<LeftNav />);
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: false })).not.toBeNull();
  });

  test("does not fire while typing in a text field", () => {
    setViewport(true);
    render(<LeftNav />);
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "]" });
    input.remove();
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: true })).not.toBeNull();
  });

  test("leaves composing or already-handled bracket events alone", () => {
    setViewport(true);
    render(<LeftNav />);
    fireEvent.keyDown(window, { key: "]", isComposing: true });
    fireEvent.keyDown(window, { key: "]", keyCode: 229 });
    const consumed = new KeyboardEvent("keydown", { key: "]", cancelable: true });
    consumed.preventDefault();
    fireEvent(window, consumed);
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: true })).not.toBeNull();
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: false })).not.toBeNull();
  });

  test("does not fire while a dialog is open", () => {
    setViewport(true);
    render(<LeftNav />);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: "]" });
    dialog.remove();
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: true })).not.toBeNull();
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
    const toggle = screen.getByRole("button", { name: "Pin sidebar", pressed: true });
    expect(footer?.contains(toggle)).toBe(false);
    expect(within(footer as HTMLElement).queryAllByRole("button")).toHaveLength(0);
    expect(navigation.contains(toggle)).toBe(false);
    expect(toggle.closest(`.${styles.sidebarToggleDock}`)).not.toBeNull();
  });

  test("shows utilities and the quiet version only with the sidebar open", async () => {
    const user = userEvent.setup();
    setViewport(false);
    render(<LeftNav />);
    const navigation = screen.getByRole("navigation", { name: "Primary" });
    expect(navigation.querySelector(`.${styles.utilityNav}`)).toBeNull();
    expect(screen.queryByText("1.7.1.2")).toBeNull();
    const opener = screen.getByRole("button", { name: "Pin sidebar", pressed: false });
    expect(navigation.contains(opener)).toBe(false);
    opener.focus();
    await user.keyboard("{Enter}");
    const utilities = navigation.querySelector(`.${styles.utilityNav}`) as HTMLElement;
    expect(within(utilities).getAllByRole("link")).toHaveLength(3);
    expect(opener.parentElement?.contains(screen.getByText("1.7.1.2"))).toBe(true);
    expect(document.activeElement).toBe(opener);
    await user.keyboard("{Enter}");
    expect(navigation.querySelector(`.${styles.utilityNav}`)).toBeNull();
    expect(screen.queryByText("1.7.1.2")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("sidebar submenu behavior", () => {
  test.each([
    ["/contacts/people", "Contacts", "People"],
    ["/contacts/orgs/org-1", "Contacts", "Organizations"],
    ["/activities/calendar", "Activities", "Calendar"],
  ])("announces only the visible current child for %s", (pathname, group, child) => {
    route.pathname = pathname;
    render(<LeftNav />);
    const navigation = screen.getByRole("navigation", { name: "Primary" });
    const current = within(navigation).getByRole("link", { name: child, current: "page" });
    const parent = within(navigation).getByRole("button", { name: group });
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(parent.getAttribute("data-active")).toBe("true");
    expect(current.getAttribute("data-active")).toBe("true");
  });

  test("moves the current-page marker to the section link when its children are hidden", () => {
    route.pathname = "/contacts/orgs/org-1";
    render(<LeftNav />);
    const navigation = screen.getByRole("navigation", { name: "Primary" });
    const links = within(navigation);
    const organizations = links.getByRole("link", { name: "Organizations" });
    fireEvent.click(links.getByRole("button", { name: "Contacts" }));
    expect(links.getByRole("button", { name: "Contacts", current: "page" })).toBeTruthy();
    expect(organizations.getAttribute("aria-current")).toBeNull();
    expect(organizations.closest("[inert]")).not.toBeNull();

    fireEvent.click(links.getByRole("button", { name: "Contacts" }));
    expect(links.getByRole("link", { name: "Organizations", current: "page" })).toBe(organizations);

    fireEvent.click(screen.getByRole("button", { name: "Pin sidebar", pressed: true }));
    expect(document.cookie).toContain("wd_nav_expanded=0");
    expect(links.getByRole("button", { name: "Contacts", current: "page" })).toBeTruthy();
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(organizations.getAttribute("aria-current")).toBeNull();
  });

  test.each(["/activities", "/activities/queue"])(
    "keeps the section current when no child matches %s",
    (pathname) => {
      route.pathname = pathname;
      render(<LeftNav />);
      const navigation = screen.getByRole("navigation", { name: "Primary" });
      expect(
        within(navigation).getByRole("button", { name: "Activities", current: "page" }),
      ).toBeTruthy();
      expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    },
  );

  test.each([
    ["/campaigns", "All campaigns"],
    ["/campaigns/subscribers/bounces", "Subscribers"],
    ["/campaigns/campaign-1", "Campaigns"],
  ])("honors the exact campaign index alongside nested sections for %s", (pathname, label) => {
    route.pathname = pathname;
    render(
      <WorkspaceShellProvider
        brand={{
          displayName: "Fixture Company",
          iconUrl: null,
          accentColor: null,
          foregroundColor: "#ffffff",
        }}
        modules={[]}
        canViewWork={false}
        canViewCampaigns
        campaignCapabilities={{ edit: false, send: false, operate: true }}
      >
        <LeftNav />
      </WorkspaceShellProvider>,
    );
    const navigation = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(navigation).getByRole(label === "Campaigns" ? "button" : "link", {
        name: label,
        current: "page",
      }),
    ).toBeTruthy();
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  test.each(["Contacts", "Activities"])("the %s row opens its nested destinations", (label) => {
    setViewport(true);
    render(<LeftNav />);
    const trigger = screen.getByRole("button", { name: label });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("link", { name: label === "Contacts" ? "People" : "Calendar" }),
    ).toBeTruthy();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("the Contacts arrow reveals and hides children in keyboard order", async () => {
    const user = userEvent.setup();
    setViewport(true);
    render(<LeftNav />);
    const disclosure = screen.getByRole("button", { name: "Contacts" });
    disclosure.focus();
    await user.keyboard("{Enter}");
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    const people = screen.getByRole("link", { name: "People" });
    expect(people.getAttribute("href")).toBe("/contacts/people");
    expect(screen.getByRole("link", { name: "Organizations" }).getAttribute("href")).toBe(
      "/contacts/orgs",
    );
    await user.tab();
    expect(document.activeElement).toBe(people);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(disclosure);
    await user.keyboard("{Enter}");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(disclosure);
    expect(people.closest("[inert]")).not.toBeNull();
    expect(people.tabIndex).toBe(-1);
    expect(screen.queryByRole("link", { name: "People" })).toBeNull();
    await user.tab();
    expect(document.activeElement).not.toBe(people);
  });
});

describe("temporary sidebar peek", () => {
  function rail() {
    // biome-ignore lint/suspicious/noDocumentCookie: Seed the persisted collapsed layout.
    document.cookie = "wd_nav_expanded=0; path=/";
    setViewport(true);
    const result = render(<LeftNav />);
    const aside = result.container.querySelector("aside")!;
    return { aside, contacts: screen.getByRole("button", { name: "Contacts" }) };
  }

  test("announces an unpinned sidebar while its branch is visibly peeking", async () => {
    const user = userEvent.setup();
    const { aside, contacts } = rail();
    contacts.focus();
    await user.keyboard("{Enter}");
    expect(aside.getAttribute("data-sidebar-state")).toBe("peeking");
    expect(screen.getByRole("link", { name: "People" })).toBeTruthy();
    const pin = screen.getByRole("button", { name: "Pin sidebar", pressed: false });
    expect(pin.hasAttribute("aria-expanded")).toBe(false);
    expect(contacts.getAttribute("aria-expanded")).toBe("true");
    expect(document.cookie).toContain("wd_nav_expanded=0");
  });

  test("Escape returns focus to the branch and closes the temporary panel", () => {
    const { aside, contacts } = rail();
    fireEvent.click(contacts);
    const people = screen.getByRole("link", { name: "People" });
    people.focus();
    fireEvent.keyDown(people, { key: "Escape" });
    expect(aside.getAttribute("data-sidebar-state")).toBe("collapsed");
    expect(document.activeElement).toBe(contacts);
    expect(document.cookie).toContain("wd_nav_expanded=0");
  });

  test("toggles the persistent pin without changing its accessible name or focus", async () => {
    const user = userEvent.setup();
    const { aside, contacts } = rail();
    fireEvent.click(contacts);
    const pin = screen.getByRole("button", { name: "Pin sidebar", pressed: false });
    pin.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: true })).toBe(pin);
    expect(pin.hasAttribute("aria-expanded")).toBe(false);
    expect(document.activeElement).toBe(pin);
    expect(aside.getAttribute("data-sidebar-state")).toBe("expanded");
    expect(document.cookie).toContain("wd_nav_expanded=1");
    fireEvent.pointerLeave(aside.querySelector(`.${styles.sidebarPanel}`)!);
    expect(aside.getAttribute("data-sidebar-state")).toBe("expanded");
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Pin sidebar", pressed: false })).toBe(pin);
    expect(pin.hasAttribute("aria-expanded")).toBe(false);
    expect(document.activeElement).toBe(pin);
    expect(aside.getAttribute("data-sidebar-state")).toBe("collapsed");
    expect(document.cookie).toContain("wd_nav_expanded=0");
  });
});
