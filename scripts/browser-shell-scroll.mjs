// Real shell boundaries inside the existing disposable, network-fenced browser journey.
// Inert local overflow fixtures add no grants, providers or production bypasses.
import assert from "node:assert/strict";
import {
  deliverRegionalSave,
  isRegionalSaveRequest,
  prepareLocaleThroughUi,
} from "./browser-locale-preferences.mjs";

async function prepareShellLocale(page, locale) {
  const origin = new URL(page.url()).origin;
  assert.equal(
    origin,
    "https://127.0.0.1:3443",
    "Shell qualification stays on the disposable loopback target",
  );
  const pattern = "**/settings/regional";
  const handler = async (route) => {
    if (isRegionalSaveRequest(route.request(), origin)) await deliverRegionalSave(route);
    else await route.fallback();
  };
  await page.route(pattern, handler);
  try {
    await prepareLocaleThroughUi(page, origin, locale);
  } finally {
    await page.unroute(pattern, handler);
  }
}

async function assertShellLocale(page, locale) {
  assert.equal(
    await page.locator("html").getAttribute("lang"),
    locale,
    "Settings must reload the saved account language",
  );
  assert.equal(
    await page.locator("html").getAttribute("dir"),
    locale === "fa" ? "rtl" : "ltr",
    "The real shell must use the requested writing direction",
  );
}

export async function exerciseShellScrollBoundaries(page, locale) {
  const response = await page.goto("/settings/profile", { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200, "Use the real authenticated settings page");
  await assertShellLocale(page, locale);
  const main = page.locator("[data-app-content]");
  const primary = page.locator("#primary-navigation");
  const topbar = page.locator("[data-app-topbar]");
  await main.waitFor();
  await topbar.waitFor();
  assert(
    await primary.isVisible(),
    "Desktop shell regression requires its real primary navigation",
  );

  const settingsNav = page
    .locator("[data-app-content] nav[aria-label]")
    .filter({ has: page.locator("input[type=search]") });
  const settingsOwner = settingsNav.locator("..");
  const hasSettingsOwner = (await settingsNav.count()) === 1 && (await settingsNav.isVisible());
  assert(
    hasSettingsOwner,
    "Desktop settings regression requires the visible real settings navigation",
  );
  await settingsNav.evaluate((element) => {
    const content = document.createElement("div");
    content.dataset.scrollRegressionFixture = "settings";
    content.style.height = "1600px";
    content.setAttribute("aria-hidden", "true");
    element.append(content);
  });

  // Inert local fixture content makes the scroll boundary deterministic without
  // requiring administrator access, live log records, provider calls or new grants.
  await main.evaluate((element) => {
    const content = document.createElement("div");
    content.dataset.scrollRegressionFixture = "main";
    content.style.height = "2400px";
    content.setAttribute("aria-hidden", "true");
    element.append(content);
    element.scrollTop = 0;
  });

  const geometry = () =>
    page.evaluate(() => {
      const box = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      };
      const content = document.querySelector("[data-app-content]");
      return {
        windowY: scrollY,
        viewport: innerHeight,
        documentHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        mainTop: content.scrollTop,
        mainMaximum: content.scrollHeight - content.clientHeight,
        primary: box("#primary-navigation"),
        topbar: box("[data-app-topbar]"),
      };
    });
  const frame = await geometry();
  assert.equal(frame.windowY, 0, "The document must start at its viewport origin");
  assert(frame.documentHeight <= frame.viewport + 1, "Only app content owns vertical scrolling");
  assert(frame.mainMaximum > 0, "The synthetic page must actually overflow");
  const mainBounds = await main.boundingBox();
  assert(mainBounds && mainBounds.height > 0);
  const rtl = (await page.locator("html").getAttribute("dir")) === "rtl";
  await page.mouse.move(
    mainBounds.x + mainBounds.width * (rtl ? 0.25 : 0.75),
    mainBounds.y + mainBounds.height * 0.55,
  );
  for (let attempt = 0; attempt < 5; attempt++) await page.mouse.wheel(0, 2000);
  await page.waitForFunction(() => {
    const element = document.querySelector("[data-app-content]");
    return element.scrollTop >= element.scrollHeight - element.clientHeight - 2;
  });
  for (let attempt = 0; attempt < 4; attempt++) await page.mouse.wheel(0, 1200);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const bottom = await geometry();
  assert.equal(bottom.windowY, 0, "Wheel input at the content boundary must not move the document");
  assert(
    bottom.documentHeight <= bottom.viewport + 1,
    "The shell must not expose a second scroll range",
  );
  for (const name of ["primary", "topbar"]) {
    assert(frame[name] && bottom[name], `${name} must exist at both boundaries`);
    assert(
      Math.abs(frame[name].top - bottom[name].top) <= 1,
      `${name} must remain vertically anchored`,
    );
    assert(
      Math.abs(frame[name].left - bottom[name].left) <= 1,
      `${name} must remain horizontally anchored`,
    );
  }

  {
    await main.evaluate((element) => {
      element.scrollTop = 0;
    });
    await settingsOwner.evaluate((element) => {
      element.scrollTop = 0;
    });
    assert(
      await settingsOwner.evaluate((element) => element.scrollHeight > element.clientHeight + 1),
      "Settings navigation fixture must overflow",
    );
    const bounds = await settingsOwner.boundingBox();
    assert(bounds && bounds.height > 0);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    for (let attempt = 0; attempt < 5; attempt++) await page.mouse.wheel(0, 1200);
    await page.waitForFunction(() => {
      const nav = document
        .querySelector("[data-app-content] nav input[type=search]")
        ?.closest("nav");
      const element = nav?.parentElement;
      return element && element.scrollTop >= element.scrollHeight - element.clientHeight - 2;
    });
    for (let attempt = 0; attempt < 4; attempt++) await page.mouse.wheel(0, 1200);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const settingsEnd = await geometry();
    assert.equal(settingsEnd.windowY, 0, "Settings navigation must not move the document");
    assert.equal(
      settingsEnd.mainTop,
      0,
      "Settings navigation boundary must not chain into app content",
    );
  }

  {
    await primary.evaluate((element) => {
      const content = document.createElement("div");
      content.dataset.scrollRegressionFixture = "navigation";
      content.style.cssText = "height:1200px;flex:0 0 1200px";
      content.setAttribute("aria-hidden", "true");
      element.append(content);
      element.scrollTop = 0;
    });
    assert(
      await primary.evaluate((element) => element.scrollHeight > element.clientHeight + 1),
      "Primary navigation fixture must overflow",
    );
    const bounds = await primary.boundingBox();
    assert(bounds && bounds.height > 0);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    for (let attempt = 0; attempt < 5; attempt++) await page.mouse.wheel(0, 1200);
    await page.waitForFunction(() => {
      const element = document.querySelector("#primary-navigation");
      return element.scrollTop >= element.scrollHeight - element.clientHeight - 2;
    });
    for (let attempt = 0; attempt < 4; attempt++) await page.mouse.wheel(0, 1200);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const navEnd = await geometry();
    assert.equal(navEnd.windowY, 0, "Navigation boundary input must not scroll the document");
    assert(
      Math.abs(navEnd.topbar.top - frame.topbar.top) <= 1,
      "Navigation scrolling must preserve the topbar",
    );
  }

  // Start immediately before the actual main landmark, then use the browser's
  // normal Tab and scrolling keys. The fixture never substitutes for main.
  await main.evaluate((element) => {
    element.scrollTop = 0;
    const before = document.createElement("button");
    before.dataset.scrollRegressionFixture = "focus-start";
    before.textContent = "Local regression focus start";
    before.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    element.before(before);
    before.focus();
  });
  await page.keyboard.press("Tab");
  assert(
    await main.evaluate((element) => document.activeElement === element),
    "Main must be reachable with Tab",
  );
  await page.keyboard.press("PageDown");
  await page.waitForFunction(() => document.querySelector("[data-app-content]").scrollTop > 0);
  await page.keyboard.press("End");
  await page.waitForFunction(() => {
    const element = document.querySelector("[data-app-content]");
    return element.scrollTop >= element.scrollHeight - element.clientHeight - 2;
  });
  assert.equal((await geometry()).windowY, 0, "Keyboard scrolling belongs to main");

  await page.evaluate(() =>
    document.querySelectorAll("[data-scroll-regression-fixture]").forEach((element) => {
      element.remove();
    }),
  );
  await main.evaluate((element) => {
    element.scrollTop = 0;
  });
}

async function waitForSidebarWidths(page, state) {
  await page.waitForFunction(
    (expectedState) => {
      const rail = document.querySelector("aside[data-sidebar-state]");
      const panel = rail?.firstElementChild;
      if (!rail || !panel || rail.getAttribute("data-sidebar-state") !== expectedState)
        return false;
      const style = getComputedStyle(rail);
      const icon = Number.parseFloat(style.getPropertyValue("--sidebar-width-icon"));
      const full = Number.parseFloat(style.getPropertyValue("--sidebar-width"));
      const outerTarget = expectedState === "expanded" ? full : icon;
      const panelTarget = expectedState === "collapsed" ? icon : full;
      const outerWidth = rail.getBoundingClientRect().width;
      const panelWidth = panel.getBoundingClientRect().width;
      return (
        outerTarget > 0 &&
        panelTarget > 0 &&
        outerWidth > 0 &&
        panelWidth > 0 &&
        Math.abs(outerWidth - outerTarget) <= 1 &&
        Math.abs(panelWidth - panelTarget) <= 1
      );
    },
    state,
    { timeout: 5000 },
  );
}

export async function exerciseCollapsedSidebar(page) {
  const sidebar = page.locator("aside[data-sidebar-state]");
  const pin = sidebar.locator('button[aria-controls="primary-navigation"]');
  assert.equal(await sidebar.count(), 1, "Use the real desktop sidebar");
  if ((await pin.getAttribute("aria-pressed")) === "true") await pin.click();
  await page.locator("[data-app-topbar]").hover();
  await sidebar.locator(':scope[data-sidebar-state="collapsed"]').waitFor();
  await waitForSidebarWidths(page, "collapsed");
  const before = await page.locator("[data-app-content]").boundingBox();
  await page.locator("#primary-navigation").hover();
  await sidebar.locator(':scope[data-sidebar-state="peeking"]').waitFor();
  await waitForSidebarWidths(page, "peeking");
  assert(
    await page.locator("#primary-navigation").evaluate((nav) => {
      const rect = nav.getBoundingClientRect();
      const rtl = document.documentElement.dir === "rtl";
      const x = rtl ? rect.left + 20 : rect.right - 20;
      const hit = document.elementFromPoint(x, rect.top + rect.height / 2);
      return hit !== null && nav.contains(hit);
    }),
    "The expanded peek must remain visible and hit-testable outside the rail",
  );
  const after = await page.locator("[data-app-content]").boundingBox();
  assert(before && after);
  assert(
    Math.abs(after.x - before.x) <= 1 && Math.abs(after.width - before.width) <= 1,
    "Peeking must not move content",
  );
  await page.locator("#primary-navigation a[href]").first().focus();
  await page.keyboard.press("Escape");
  await sidebar.locator(':scope[data-sidebar-state="collapsed"]').waitFor();
  await waitForSidebarWidths(page, "collapsed");
  await pin.click();
  assert.equal(await pin.getAttribute("aria-pressed"), "true");
  await waitForSidebarWidths(page, "expanded");
}

export async function exerciseMobileSidebar(page, locale) {
  const response = await page.goto("/settings/profile", { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200);
  await assertShellLocale(page, locale);
  const main = page.locator("[data-app-content]");
  await main.evaluate((element) => {
    const fixture = document.createElement("div");
    fixture.dataset.scrollRegressionFixture = "mobile-content";
    fixture.style.height = "2400px";
    fixture.setAttribute("aria-hidden", "true");
    element.append(fixture);
    element.scrollTop = 0;
  });
  assert(await main.evaluate((element) => element.scrollHeight > element.clientHeight + 1));
  const contentBounds = await main.boundingBox();
  assert(contentBounds && contentBounds.height > 0);
  await page.mouse.move(
    contentBounds.x + contentBounds.width / 2,
    contentBounds.y + contentBounds.height / 2,
  );
  for (let attempt = 0; attempt < 6; attempt++) await page.mouse.wheel(0, 1600);
  await page.waitForFunction(() => {
    const element = document.querySelector("[data-app-content]");
    return element.scrollTop >= element.scrollHeight - element.clientHeight - 2;
  });
  for (let attempt = 0; attempt < 3; attempt++) await page.mouse.wheel(0, 1200);
  assert(
    await page.evaluate(
      () =>
        scrollY === 0 &&
        Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) <=
          innerHeight + 1,
    ),
    "Mobile content must stay within its viewport",
  );
  await main.evaluate((element) => {
    element.querySelector('[data-scroll-regression-fixture="mobile-content"]').remove();
    element.scrollTop = 0;
  });
  const trigger = page.locator("#mobile-navigation-trigger");
  await trigger.tap();
  const panel = page.locator("#mobile-navigation-panel");
  await panel.waitFor();
  // Visibility begins while the drawer is still outside the viewport. Wait for
  // its real entered geometry before aiming wheel input at the navigation.
  await page.waitForFunction(() => {
    const element = document.querySelector("#mobile-navigation-panel");
    if (!element) return false;
    const bounds = element.getBoundingClientRect();
    return (
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.left >= -1 &&
      bounds.right <= innerWidth + 1 &&
      bounds.top >= -1 &&
      bounds.bottom <= innerHeight + 1
    );
  });
  assert(
    await panel
      .locator('[data-slot="sheet-close"]')
      .evaluate((element) => document.activeElement === element),
    "Drawer opens with focus on its close control",
  );
  const nav = page.locator("#mobile-primary-navigation");
  await nav.evaluate((element) => {
    const fixture = document.createElement("div");
    fixture.dataset.scrollRegressionFixture = "mobile-navigation";
    fixture.style.cssText = "height:1600px;flex:0 0 1600px";
    fixture.setAttribute("aria-hidden", "true");
    element.append(fixture);
    element.scrollTop = 0;
  });
  assert(
    await nav.evaluate((element) => element.scrollHeight > element.clientHeight + 1),
    "Drawer navigation must actually overflow",
  );
  const bounds = await nav.boundingBox();
  assert(bounds && bounds.height > 0);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  for (let attempt = 0; attempt < 6; attempt++) await page.mouse.wheel(0, 1600);
  await page.waitForFunction(() => {
    const element = document.querySelector("#mobile-primary-navigation");
    return element.scrollTop >= element.scrollHeight - element.clientHeight - 2;
  });
  for (let attempt = 0; attempt < 3; attempt++) await page.mouse.wheel(0, 1200);
  assert.equal(await page.evaluate(() => scrollY), 0, "Drawer boundary must not move the document");
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  assert(
    await trigger.evaluate((element) => document.activeElement === element),
    "Escape restores focus to the drawer trigger",
  );
  assert.equal(await page.evaluate(() => scrollY), 0);
}

export async function runShellScrollBrowserSmoke({ journey, signIn }) {
  for (const [locale, height] of [
    ["en", 827],
    ["fa", 560],
  ]) {
    await journey(
      `shell-scroll-${locale}-${height}`,
      locale,
      async (page) => {
        await signIn(page);
        await prepareShellLocale(page, locale);
        await exerciseShellScrollBoundaries(page, locale);
        await exerciseCollapsedSidebar(page);
      },
      { width: 1280, height },
    );
    await journey(
      `shell-mobile-${locale}`,
      locale,
      async (page) => {
        await signIn(page);
        await prepareShellLocale(page, locale);
        await exerciseMobileSidebar(page, locale);
        // Later smoke journeys share this account and start from English.
        if (locale !== "en") await prepareShellLocale(page, "en");
      },
      { width: 390, height: 660 },
      true,
    );
  }
}
