// Real settings UI and native administrator reads. Retain only finite proof facts.
// No screenshots, traces, cookies, request bodies or response payload artifacts.
import { createHmac } from "node:crypto";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const operationsStages = new Set([
  "operations-browser-context",
  "operations-admin-login-document",
  "operations-admin-password-submit",
  "operations-admin-enrollment-available",
  "operations-admin-enrollment-password",
  "operations-admin-enrollment-start",
  "operations-admin-setup-key-visible",
  "operations-admin-totp-submit",
  "operations-admin-recovery-visible",
  "operations-admin-recovery-acknowledge",
  "operations-admin-workspace-ready",
  "operations-maintenance-document",
  "operations-maintenance-read",
  "operations-logs-document",
  "operations-facts-render",
  "operations-release-banner",
  "operations-release-banner-response",
  "operations-release-banner-foreground",
  "operations-release-banner-viewport",
  "operations-release-banner-show",
  "operations-release-banner-expand",
  "operations-release-banner-notes",
  "operations-release-banner-header",
  "operations-release-banner-overflow",
  "operations-release-banner-document",
  "operations-release-banner-topbar",
  "operations-release-banner-focus",
  "operations-release-banner-end",
  "operations-release-banner-last-line",
  "operations-release-banner-wheel",
  "operations-release-banner-boundary",
  "operations-release-banner-collapse",
  "operations-release-banner-collapsed",
  "operations-release-banner-reopen",
  "operations-release-banner-reopened",
  "operations-release-banner-dismiss-focus",
  "operations-release-banner-dismiss-tab",
  "operations-release-banner-dismiss",
  "operations-release-banner-dismissed-notes",
  "operations-release-banner-dismissed-control",
  "operations-release-banner-dismissed-document",
  "operations-release-banner-other-tab-dismiss",
  "operations-release-banner-restore",
  "operations-metadata-fields",
  "operations-recovered-incident",
  "operations-initial-mounted",
  "operations-role-revoke-await",
  "operations-api403-maintenance",
  "operations-api403-logs",
  "operations-denied-mounted",
  "operations-regrant-await",
  "operations-regrant-hold",
  "operations-resume-maintenance",
  "operations-refresh-maintenance",
  "operations-resume-logs",
  "operations-refresh-logs",
  "operations-restored-mounted",
]);
export function operationsProgressStage(value) {
  if (!operationsStages.has(value)) throw Error("Unknown operations browser progress");
  return value;
}

// RFC 6238 SHA-1/6-digit/30-second defaults used by the installed native plugin.
// The displayed setup key and generated code exist only in this process memory.
export function operationsTotp(secret, milliseconds = Date.now()) {
  if (
    typeof secret !== "string" ||
    !/^[A-Z2-7]{16,128}$/.test(secret) ||
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0
  )
    throw Error("Synthetic authenticator input was not admitted");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = [];
  let value = 0,
    bits = 0;
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
      value &= (1 << bits) - 1;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(milliseconds / 30000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}

const releaseBannerLastLine = "Synthetic release note line 300: end of the local fixture.";

const layoutNumbers = [
  "windowY",
  "windowX",
  "viewport",
  "viewportWidth",
  "documentHeight",
  "visualViewportHeight",
  "visualViewportOffsetTop",
  "visualViewportScale",
  "htmlZoom",
  "bodyZoom",
  "rootZoom",
  "cssRulesVisited",
  "documentScrollHeight",
  "documentClientHeight",
  "bodyScrollHeight",
  "bodyClientHeight",
  "bodyTop",
  "bodyBottom",
  "bodyHeight",
  "rootTop",
  "rootBottom",
  "rootHeight",
  "rootClientHeight",
  "rootScrollHeight",
  "rootComputedHeight",
  "rootMinHeight",
  "rootParentHeight",
  "rootParentClientHeight",
  "rootParentScrollHeight",
  "columnTop",
  "columnBottom",
  "columnHeight",
  "columnClientHeight",
  "columnScrollHeight",
  "mainTop",
  "mainRectTop",
  "mainRectBottom",
  "mainRectHeight",
  "mainClientHeight",
  "mainScrollHeight",
  "notesTop",
  "notesBottom",
  "notesHeight",
  "notesClientHeight",
  "notesScrollHeight",
  "notesScrollTop",
  "barTop",
  "barBottom",
  "barHeight",
  "navTop",
  "navBottom",
  "navHeight",
  "bodyChildrenCount",
  "bodyDirectChildMaxBottom",
  "bodyChildrenPastViewportCount",
];
const layoutBooleans = [
  "rootPresent",
  "rootHasHDvh",
  "rootHasHScreen",
  "rootHasOverflowHidden",
  "rootOverflowYHidden",
  "rootOverflowXHidden",
  "columnOverflowYHidden",
  "mainOverflowYAuto",
  "notesPresent",
  "notesOverflowYAuto",
  "hDvhRuleFound",
  "hDvhRuleHas100Dvh",
  "hDvhRuleScanComplete",
];

// Closed diagnostic data: numeric geometry and fixed booleans only. No DOM text,
// HTML, actor, headers, URLs, operations responses or arbitrary error fields.
export function operationsLayoutRecord(frames) {
  const names = ["afterViewport", "beforeExpand", "afterExpand"];
  const keys = [...layoutNumbers, ...layoutBooleans];
  if (
    !frames ||
    Object.keys(frames).length !== names.length ||
    Object.keys(frames).some((name) => !names.includes(name))
  )
    throw Error("Unexpected operations layout frames");
  const record = { schemaVersion: 1 };
  for (const name of names) {
    const frame = frames[name];
    if (
      !frame ||
      Object.keys(frame).length !== keys.length ||
      Object.keys(frame).some((key) => !keys.includes(key)) ||
      layoutNumbers.some(
        (key) =>
          typeof frame[key] !== "number" ||
          !Number.isFinite(frame[key]) ||
          Math.abs(frame[key]) > 1_000_000_000,
      ) ||
      layoutBooleans.some((key) => typeof frame[key] !== "boolean")
    )
      throw Error("Unexpected operations layout facts");
    record[name] = Object.fromEntries(keys.map((key) => [key, frame[key]]));
  }
  return record;
}

function writeOperationsLayout(outputDir, frames) {
  if (!isAbsolute(outputDir)) throw Error("Unexpected operations output directory");
  const record = operationsLayoutRecord(frames);
  const encoded = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(encoded) > 16384) throw Error("Operations layout record exceeds its bound");
  const descriptor = openSync(join(outputDir, "operations-layout.json"), "wx", 0o600);
  try {
    writeFileSync(descriptor, encoded);
  } finally {
    closeSync(descriptor);
  }
}

// Replace only successful native version reads. Authentication errors and every
// other batched result retain their original objects; no real response is logged.
export function operationsReleaseBannerResponse(body, names) {
  const index = names.indexOf("version.get");
  if (index < 0) return body;
  const entries = Array.isArray(body) ? body : [body];
  if (
    entries.length !== names.length ||
    names.filter((name) => name === "version.get").length !== 1
  )
    throw Error("Release banner response shape changed");
  const entry = entries[index];
  if (entry?.error) return body;
  const data = entry?.result?.data;
  if (data === null || typeof data !== "object" || Array.isArray(data))
    throw Error("Native release version result was not observed");
  const native = Object.hasOwn(data, "json") ? data.json : data;
  if (
    !native ||
    typeof native.current !== "string" ||
    typeof native.disabled !== "boolean" ||
    !["latest", "releaseUrl", "releaseNotes", "checkedAt"].every(
      (key) => native[key] === null || typeof native[key] === "string",
    ) ||
    !(native.updateAvailable === null || typeof native.updateAvailable === "boolean")
  )
    throw Error("Native release version contract changed");
  const fixture = {
    current: [
      "1.7.1 synthetic frontend qualification build with a deliberately descriptive source identity",
      "for the local wrapped header and bounded release note regression on the real administrator page",
    ].join(" "),
    latest: "v999.0.0",
    releaseUrl: null,
    releaseNotes: [
      ...Array.from({ length: 299 }, (_, line) => `Synthetic release note line ${line + 1}.`),
      releaseBannerLastLine,
    ].join("\n"),
    updateAvailable: true,
    checkedAt: null,
    disabled: false,
  };
  const changed = [...entries];
  changed[index] = {
    ...entry,
    result: {
      ...entry.result,
      data: Object.hasOwn(data, "json") ? { ...data, json: fixture } : fixture,
    },
  };
  return Array.isArray(body) ? changed : changed[0];
}

async function qualifyOperationsReleaseBanner(
  page,
  maintenance,
  until,
  fail,
  progress,
  recordLayout,
) {
  let completed = false;
  const frames = {};
  const show = page.getByRole("button", { name: "Show release notes", exact: true });
  const notes = page.getByRole("region", { name: "Show release notes", exact: true });
  const topbar = page.locator("[data-app-topbar]");
  const geometry = () =>
    page.evaluate(() => {
      const main = document.querySelector("[data-app-content]");
      const root = main?.closest("[data-density]");
      const column = main?.parentElement;
      const notes = document.querySelector('section[aria-label="Show release notes"]');
      const rect = (element) =>
        element?.getBoundingClientRect() ?? { top: -1, bottom: -1, height: -1 };
      const style = (element) => (element ? getComputedStyle(element) : {});
      const number = (value) => (Number.isFinite(value) ? value : -1);
      // Do not introduce a missing utility as a new Tailwind scan candidate.
      const viewportUtility = ["h", "dvh"].join("-");
      const clippedUtility = ["overflow", "hidden"].join("-");
      const utilityScan = { visited: 0, found: false, hasViewportHeight: false, complete: true };
      const visit = (rules, depth = 0) => {
        if (depth > 10) {
          utilityScan.complete = false;
          return;
        }
        for (const rule of rules) {
          if (++utilityScan.visited > 50_000) {
            utilityScan.complete = false;
            return;
          }
          if (
            rule.selectorText
              ?.split(",")
              .some((selector) => selector.trim() === `.${viewportUtility}`)
          ) {
            utilityScan.found = true;
            utilityScan.hasViewportHeight =
              rule.style?.getPropertyValue("height").trim() === "100dvh";
          }
          if (rule.cssRules) visit(rule.cssRules, depth + 1);
          if (utilityScan.hasViewportHeight || utilityScan.visited > 50_000) return;
        }
      };
      for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])]) {
        try {
          visit(sheet.cssRules);
        } catch {
          utilityScan.complete = false;
        }
        if (utilityScan.hasViewportHeight || utilityScan.visited > 50_000) break;
      }
      const body = rect(document.body);
      const box = rect(root);
      const rootParent = root?.parentElement;
      const parent = rect(column);
      const content = rect(main);
      const note = rect(notes);
      const bar = rect(document.querySelector("[data-app-topbar]"));
      const nav = rect(document.querySelector("#primary-navigation"));
      return {
        windowY: scrollY,
        windowX: scrollX,
        viewport: innerHeight,
        viewportWidth: innerWidth,
        visualViewportHeight: number(window.visualViewport?.height),
        visualViewportOffsetTop: number(window.visualViewport?.offsetTop),
        visualViewportScale: number(window.visualViewport?.scale),
        htmlZoom: number(Number.parseFloat(style(document.documentElement).zoom)),
        bodyZoom: number(Number.parseFloat(style(document.body).zoom)),
        rootZoom: number(Number.parseFloat(style(root).zoom)),
        cssRulesVisited: utilityScan.visited,
        documentHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        documentScrollHeight: document.documentElement.scrollHeight,
        documentClientHeight: document.documentElement.clientHeight,
        bodyScrollHeight: document.body.scrollHeight,
        bodyClientHeight: document.body.clientHeight,
        bodyTop: body.top,
        bodyBottom: body.bottom,
        bodyHeight: body.height,
        rootTop: box.top,
        rootBottom: box.bottom,
        rootHeight: box.height,
        rootClientHeight: number(root?.clientHeight),
        rootScrollHeight: number(root?.scrollHeight),
        rootComputedHeight: number(Number.parseFloat(style(root).height)),
        rootMinHeight: number(Number.parseFloat(style(root).minHeight)),
        rootParentHeight: rect(rootParent).height,
        rootParentClientHeight: number(rootParent?.clientHeight),
        rootParentScrollHeight: number(rootParent?.scrollHeight),
        columnTop: parent.top,
        columnBottom: parent.bottom,
        columnHeight: parent.height,
        columnClientHeight: number(column?.clientHeight),
        columnScrollHeight: number(column?.scrollHeight),
        mainTop: number(main?.scrollTop),
        mainRectTop: content.top,
        mainRectBottom: content.bottom,
        mainRectHeight: content.height,
        mainClientHeight: number(main?.clientHeight),
        mainScrollHeight: number(main?.scrollHeight),
        notesTop: note.top,
        notesBottom: note.bottom,
        notesHeight: note.height,
        notesClientHeight: number(notes?.clientHeight),
        notesScrollHeight: number(notes?.scrollHeight),
        notesScrollTop: number(notes?.scrollTop),
        barTop: bar.top,
        barBottom: bar.bottom,
        barHeight: bar.height,
        navTop: nav.top,
        navBottom: nav.bottom,
        navHeight: nav.height,
        bodyChildrenCount: document.body.children.length,
        bodyDirectChildMaxBottom: Math.max(
          0,
          ...Array.from(document.body.children, (element) => rect(element).bottom),
        ),
        bodyChildrenPastViewportCount: Array.from(document.body.children).filter(
          (element) => rect(element).bottom > innerHeight + 1,
        ).length,
        rootPresent: root !== null && root !== undefined,
        rootHasHDvh: root?.classList.contains(viewportUtility) === true,
        rootHasHScreen: root?.classList.contains(["h", "screen"].join("-")) === true,
        rootHasOverflowHidden: root?.classList.contains(clippedUtility) === true,
        rootOverflowYHidden: style(root).overflowY === "hidden",
        rootOverflowXHidden: style(root).overflowX === "hidden",
        columnOverflowYHidden: style(column).overflowY === "hidden",
        mainOverflowYAuto: style(main).overflowY === "auto",
        notesPresent: notes !== null,
        notesOverflowYAuto: style(notes).overflowY === "auto",
        hDvhRuleFound: utilityScan.found,
        hDvhRuleHas100Dvh: utilityScan.hasViewportHeight,
        hDvhRuleScanComplete: utilityScan.complete,
      };
    });
  try {
    progress("operations-release-banner-foreground");
    await page.bringToFront();
    progress("operations-release-banner-viewport");
    await page.setViewportSize({ width: 900, height: 560 });
    frames.afterViewport = await geometry();
    progress("operations-release-banner-show");
    await show.waitFor({ state: "visible" });
    frames.beforeExpand = await geometry();
    progress("operations-release-banner-expand");
    await show.click();
    progress("operations-release-banner-notes");
    await notes.waitFor({ state: "visible" });
    const hide = page.getByRole("button", { name: "Hide release notes", exact: true });
    progress("operations-release-banner-header");
    fail(
      await hide.locator("..").evaluate((element) => {
        const spans = element.querySelectorAll(":scope > span");
        return (
          spans.length === 2 &&
          spans[1].getBoundingClientRect().top > spans[0].getBoundingClientRect().top + 1
        );
      }),
      "Synthetic release header did not exercise wrapping",
    );
    progress("operations-release-banner-overflow");
    fail(
      await notes.evaluate(
        (element) => element.scrollHeight > element.clientHeight + 1 && element.clientHeight > 0,
      ),
      "Expanded release notes must actually overflow their own region",
    );
    progress("operations-release-banner-document");
    const frame = await geometry();
    frames.afterExpand = frame;
    if (!(frame.windowY === 0 && frame.documentHeight <= frame.viewport + 1)) recordLayout(frames);
    fail(
      frame.windowY === 0 && frame.documentHeight <= frame.viewport + 1,
      "Expanded release notes overflowed the document",
    );
    progress("operations-release-banner-topbar");
    fail(
      frame.barTop >= 0 && frame.barBottom <= frame.viewport && (await topbar.isVisible()),
      "Expanded release notes hid the topbar",
    );
    progress("operations-release-banner-focus");
    await hide.focus();
    for (let attempt = 0; attempt < 4; attempt++) {
      if (await notes.evaluate((element) => document.activeElement === element)) break;
      await page.keyboard.press("Tab");
    }
    fail(
      await notes.evaluate((element) => document.activeElement === element),
      "Release notes region was not reachable with Tab",
    );
    progress("operations-release-banner-end");
    await page.keyboard.press("End");
    await until(() =>
      notes.evaluate(
        (element) => element.scrollTop >= element.scrollHeight - element.clientHeight - 2,
      ),
    );
    progress("operations-release-banner-last-line");
    fail(
      await notes.evaluate((element, lastLine) => {
        const text = element.querySelector("bdi")?.firstChild;
        if (!text || text.nodeType !== Node.TEXT_NODE) return false;
        const start = text.textContent.lastIndexOf(lastLine);
        if (start < 0) return false;
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + lastLine.length);
        const line = range.getBoundingClientRect();
        const region = element.getBoundingClientRect();
        return line.height > 0 && line.top >= region.top - 1 && line.bottom <= region.bottom + 1;
      }, releaseBannerLastLine),
      "The last release note was not reachable with the keyboard",
    );
    progress("operations-release-banner-wheel");
    const bounds = await notes.boundingBox();
    fail(bounds && bounds.height > 0, "Release note scroll region was not visible");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    for (let attempt = 0; attempt < 3; attempt++) await page.mouse.wheel(0, 1200);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    progress("operations-release-banner-boundary");
    const end = await geometry();
    fail(
      end.windowY === 0 &&
        end.documentHeight <= end.viewport + 1 &&
        end.mainTop === frame.mainTop &&
        Math.abs(end.barTop - frame.barTop) <= 1 &&
        Math.abs(end.navTop - frame.navTop) <= 1,
      "Release note boundary input moved the document or shell",
    );
    progress("operations-release-banner-collapse");
    await hide.click();
    progress("operations-release-banner-collapsed");
    await notes.waitFor({ state: "hidden" });
    progress("operations-release-banner-reopen");
    await show.click();
    progress("operations-release-banner-reopened");
    await notes.waitFor({ state: "visible" });
    const reopened = page.getByRole("button", { name: "Hide release notes", exact: true });
    const dismiss = reopened.locator("..").getByRole("button", { name: "Dismiss", exact: true });
    progress("operations-release-banner-dismiss-focus");
    await reopened.focus();
    progress("operations-release-banner-dismiss-tab");
    await page.keyboard.press("Tab");
    fail(
      await dismiss.evaluate((element) => document.activeElement === element),
      "Release dismissal was not reachable with Tab",
    );
    progress("operations-release-banner-dismiss");
    await page.keyboard.press("Enter");
    progress("operations-release-banner-dismissed-notes");
    await notes.waitFor({ state: "hidden" });
    progress("operations-release-banner-dismissed-control");
    await dismiss.waitFor({ state: "hidden" });
    progress("operations-release-banner-dismissed-document");
    fail((await geometry()).windowY === 0, "Release dismissal moved the document");
    // The other real admin tab mounted before localStorage dismissal. Close its
    // collapsed fixture too, preserving both documents for the authority checks.
    progress("operations-release-banner-other-tab-dismiss");
    await maintenance
      .getByRole("button", { name: "Show release notes", exact: true })
      .locator("..")
      .getByRole("button", { name: "Dismiss", exact: true })
      .click();
    completed = true;
  } finally {
    // Preserve the original finite failure stage when cleanup follows a failure.
    if (completed) progress("operations-release-banner-restore");
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}

const receiptMetadataFields = [
  "receiptId",
  "sourceId",
  "generationId",
  "sequence",
  "payloadSha256",
  "observationCount",
  "observedAt",
  "receivedAt",
  "recordedAt",
];

export function isOperationsReceiptFixturePage(items) {
  if (!Array.isArray(items) || items.length !== 4) return false;
  // Retained images can omit diagnostics. The seeded receipts contain no diagnostics.
  const includesDiagnostics = Object.hasOwn(items[0] ?? {}, "diagnostics");
  const fields = includesDiagnostics
    ? [...receiptMetadataFields, "diagnostics"]
    : receiptMetadataFields;
  for (const item of items) {
    if (
      item === null ||
      typeof item !== "object" ||
      Object.keys(item).length !== fields.length ||
      !fields.every((key) => Object.hasOwn(item, key)) ||
      (includesDiagnostics && (!Array.isArray(item.diagnostics) || item.diagnostics.length !== 0))
    )
      return false;
  }
  return true;
}

export async function qualifyOperations({
  browser,
  profile,
  base,
  wsUrl,
  metrics,
  emit,
  command,
  until,
  fail,
  unchanged,
  progress,
}) {
  progress("operations-browser-context");
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: 1440, height: 1000 },
  });
  const reads = [
    "operations.observations",
    "operations.sources",
    "operations.incidents",
    "operations.events",
  ];
  const accepted = Object.fromEntries(reads.map((name) => [name, 0]));
  const forbidden = Object.fromEntries(reads.map((name) => [name, 0]));
  let nativeLogin = false,
    nativeMfaEnrollment = false,
    nativeMfaVerified = false,
    operationRequests = 0,
    metadataOnly = false,
    invalid = false,
    releaseBannerFixtureResponses = 0;
  const observing = new Set();
  const pages = [];
  function mfaWasVerified() {
    return nativeMfaEnrollment && nativeMfaVerified;
  }
  try {
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base) {
        metrics.blockedRequests++;
        await route.abort();
      } else if (
        request.method() === "GET" &&
        url.pathname.startsWith("/api/trpc/") &&
        url.pathname.slice("/api/trpc/".length).split(",").includes("version.get")
      ) {
        fail(
          url.protocol === "https:" && url.hostname === "127.0.0.1" && Boolean(url.port),
          "Release banner fixture requires loopback HTTPS",
        );
        try {
          const response = await route.fetch({ maxRedirects: 0, timeout: 15000 });
          if (!response.ok()) return await route.fulfill({ response });
          const body = await response.json();
          const changed = operationsReleaseBannerResponse(
            body,
            url.pathname.slice("/api/trpc/".length).split(","),
          );
          if (changed === body) return await route.fulfill({ response });
          releaseBannerFixtureResponses++;
          const headers = { ...response.headers(), "content-type": "application/json" };
          delete headers["content-length"];
          delete headers["content-encoding"];
          await route.fulfill({ response, headers, body: JSON.stringify(changed) });
        } catch {
          invalid = true;
          await route.abort().catch(() => {});
        }
      } else await route.continue();
    });
    await context.routeWebSocket("**/*", (route) => {
      if (route.url() !== wsUrl) {
        metrics.blockedWebSockets++;
        void route.close({ code: 1008 });
      } else route.connectToServer();
    });
    function observe(page) {
      pages.push(page);
      page.on("pageerror", () => {
        metrics.pageErrors++;
      });
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith("/api/trpc/"))
          operationRequests += path
            .slice("/api/trpc/".length)
            .split(",")
            .filter((name) => reads.includes(name)).length;
      });
      page.on("response", (response) => {
        const path = new URL(response.url()).pathname;
        if (path === "/api/auth/sign-in/email" && response.ok()) nativeLogin = true;
        if (path === "/api/auth/two-factor/enable" && response.ok()) nativeMfaEnrollment = true;
        if (path === "/api/auth/two-factor/verify-totp" && response.ok()) nativeMfaVerified = true;
        if (!path.startsWith("/api/trpc/")) return;
        const names = path.slice("/api/trpc/".length).split(",");
        if (!names.some((name) => reads.includes(name))) return;
        const task = (async () => {
          const body = await response.json();
          const entries = Array.isArray(body) ? body : [body];
          fail(entries.length === names.length, "Operations response shape changed");
          for (let index = 0; index < names.length; index++) {
            const name = names[index];
            if (!reads.includes(name)) continue;
            const entry = entries[index];
            const error = entry?.error?.json ?? entry?.error;
            if (error) {
              fail(
                error.data?.code === "FORBIDDEN" && error.data?.httpStatus === 403,
                "Unexpected operations API refusal",
              );
              forbidden[name]++;
            } else {
              const data = entry?.result?.data?.json ?? entry?.result?.data;
              fail(data && Array.isArray(data.items), "Operations API did not return a page");
              accepted[name]++;
              if (name === "operations.events") {
                fail(
                  isOperationsReceiptFixturePage(data.items),
                  "Receipt API exposed unexpected fields",
                );
                metadataOnly = true;
              }
            }
          }
        })().catch(() => {
          invalid = true;
        });
        observing.add(task);
        void task.then(() => observing.delete(task));
      });
    }
    const maintenance = await context.newPage();
    observe(maintenance);
    progress("operations-admin-login-document");
    await maintenance.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    progress("operations-admin-password-submit");
    await maintenance.locator('input[name="email"]').fill(profile.adminEmail);
    await maintenance.locator('input[name="password"]').fill(profile.adminPassword);
    await maintenance.locator('button[type="submit"]').click();
    progress("operations-admin-enrollment-available");
    const enrollButton = maintenance.getByRole("button", {
      name: "Set up authenticator",
      exact: true,
    });
    await enrollButton.waitFor({ state: "visible", timeout: 30000 });
    progress("operations-admin-enrollment-password");
    // The current page also offers first-factor reauthentication in a separate
    // panel with the same field label. Select the actual enrollment section.
    const enrollment = enrollButton.locator("xpath=ancestor::section[1]");
    await enrollment.getByLabel("Current password", { exact: true }).fill(profile.adminPassword);
    progress("operations-admin-enrollment-start");
    await enrollButton.click();
    const keyNode = maintenance
      .getByText("Setup key", { exact: true })
      .locator("..")
      .locator('p[dir="ltr"]');
    progress("operations-admin-setup-key-visible");
    await keyNode.waitFor({ state: "visible" });
    let setupKey = await keyNode.textContent();
    progress("operations-admin-totp-submit");
    await maintenance
      .getByLabel("Authenticator code", { exact: true })
      .fill(operationsTotp(setupKey));
    setupKey = "";
    await maintenance.getByRole("button", { name: "Verify code", exact: true }).click();
    progress("operations-admin-recovery-visible");
    const recovery = maintenance.getByRole("region", { name: "Recovery codes", exact: true });
    await recovery.waitFor({ state: "visible" });
    fail(
      mfaWasVerified() && (await recovery.locator("li").count()) === 10,
      "Native administrator MFA ceremony was not proven",
    );
    progress("operations-admin-recovery-acknowledge");
    // Disposable synthetic account: acknowledge the UI without exporting recovery codes.
    await recovery
      .getByRole("checkbox", { name: "I have stored my recovery codes safely", exact: true })
      .check();
    await recovery.getByRole("button", { name: "Continue", exact: true }).click();
    progress("operations-admin-workspace-ready");
    await maintenance
      .getByRole("main", { name: `Board ${profile.pipelineName}`, exact: true })
      .waitFor({ state: "visible", timeout: 30000 });
    fail(nativeLogin, "Native administrator login response was not observed");
    progress("operations-maintenance-document");
    await maintenance.goto(`${base}/settings/maintenance`, { waitUntil: "domcontentloaded" });
    await maintenance.bringToFront();
    progress("operations-maintenance-read");
    await until(
      () =>
        !invalid && accepted["operations.observations"] > 0 && accepted["operations.sources"] > 0,
    );
    const logs = await context.newPage();
    observe(logs);
    progress("operations-logs-document");
    await logs.goto(`${base}/settings/logs`, { waitUntil: "domcontentloaded" });
    const maintenanceCard = maintenance
      .locator("div.rounded-lg.bg-card")
      .filter({ has: maintenance.getByRole("heading", { name: "Operations", exact: true }) });
    const logsCard = logs
      .locator("div.rounded-lg.bg-card")
      .filter({ has: logs.getByRole("heading", { name: "Operations history", exact: true }) });
    const observations = maintenanceCard.getByRole("region", {
      name: "Reported component and feature status",
      exact: true,
    });
    const sources = maintenanceCard.getByRole("region", {
      name: "Observation sources",
      exact: true,
    });
    const incidents = logsCard.getByRole("region", { name: "Incidents", exact: true });
    const receipts = logsCard.getByRole("region", { name: "Observation receipts", exact: true });
    async function present(locator) {
      return (await locator.count()) > 0 && (await locator.isVisible());
    }
    async function text(locator, value) {
      return present(locator.getByText(value, { exact: true }));
    }
    const component = observations.locator("article").filter({
      has: maintenance.getByRole("heading", { name: "Component · Web application", exact: true }),
    });
    const queue = observations.locator("article").filter({
      has: maintenance.getByRole("heading", { name: "Queue · file.reaper", exact: true }),
    });
    const unsampled = observations.locator("article").filter({
      has: maintenance.getByRole("heading", { name: "Queue · email.send.process", exact: true }),
    });
    const unknown = observations
      .locator("article")
      .filter({ has: maintenance.getByRole("heading", { name: "Provider · SMTP", exact: true }) });
    async function initialFacts() {
      return (
        !invalid &&
        reads.every((name) => accepted[name] > 0) &&
        metadataOnly &&
        (await text(component, "Healthy")) &&
        (await text(component, "Installed identity has not been reported.")) &&
        (await text(queue, "Stale")) &&
        (await text(unsampled, "Not checked")) &&
        (await text(unknown, "Unknown")) &&
        (await sources.locator("article").count()) === 2 &&
        (await receipts.locator("article").count()) === 4
      );
    }
    progress("operations-facts-render");
    await until(initialFacts);
    progress("operations-release-banner");
    progress("operations-release-banner-response");
    fail(releaseBannerFixtureResponses > 0, "Successful native version read was not observed");
    await qualifyOperationsReleaseBanner(logs, maintenance, until, fail, progress, (frames) =>
      writeOperationsLayout(profile.outputDir, frames),
    );
    progress("operations-metadata-fields");
    const age = queue
      .getByText("Oldest ready job (seconds)", { exact: true })
      .locator("..")
      .locator("dd");
    fail(
      (await age.textContent()) === "Not reported",
      "Null queue age was not shown as not reported",
    );
    for (const label of ["Pending jobs", "Active jobs"]) {
      const metric = queue.getByText(label, { exact: true }).locator("..");
      fail(
        (await metric.locator("dd").textContent()) === "0",
        "Genuine zero queue count was not preserved",
      );
    }
    for (const label of ["Pending jobs", "Active jobs", "Oldest ready job (seconds)"]) {
      const metric = unsampled.getByText(label, { exact: true }).locator("..");
      fail(
        (await metric.locator("dd").textContent()) === "Not reported",
        "Unsampled queue gauge became zero",
      );
    }
    fail(
      await present(
        sources.getByText(
          "Enabled enrollment allows a source to report. It does not mean a service is healthy.",
          { exact: true },
        ),
      ),
      "Enrollment was presented as service health",
    );
    fail(
      (await sources.getByText("Enrollment enabled", { exact: true }).count()) === 2,
      "Source enrollment was not rendered",
    );
    fail(
      (await maintenanceCard
        .getByText("Only this page is shown; there is no installation-wide health summary.", {
          exact: false,
        })
        .count()) === 2,
      "Maintenance page scope missing",
    );
    progress("operations-recovered-incident");
    await logsCard.getByRole("checkbox", { name: "Open incidents only", exact: true }).uncheck();
    await until(
      async () =>
        await text(
          incidents
            .locator("article")
            .filter({ has: logs.getByText("component:web", { exact: true }) }),
          "Recovered",
        ),
    );
    fail(
      (await logsCard
        .getByText("Only this page is shown; there is no installation-wide health summary.", {
          exact: false,
        })
        .count()) === 2,
      "History page scope missing",
    );
    fail(
      (await receipts.getByText("Payload fingerprint", { exact: true }).count()) === 4,
      "Receipt metadata was not rendered",
    );
    const maintenanceHandle = await maintenanceCard.elementHandle();
    const logsHandle = await logsCard.elementHandle();
    const documents = await Promise.all(pages.map((page) => page.locator("html").elementHandle()));
    const urls = pages.map((page) => page.url());
    async function retained() {
      fail(!invalid, "Operations API observation failed");
      for (let index = 0; index < pages.length; index++)
        fail(
          pages[index].url() === urls[index] &&
            (await documents[index].evaluate((element) => element.isConnected)),
          "Operations document was replaced",
        );
      fail(
        (await maintenanceHandle.evaluate((element) => element.isConnected)) &&
          (await logsHandle.evaluate((element) => element.isConnected)),
        "Operations section remounted",
      );
      await unchanged();
    }
    progress("operations-initial-mounted");
    await retained();
    emit("operations-ready", {
      nativeAdminLogin: true,
      nativeAdminMfa: true,
      realFactsRendered: true,
      staleAndUnknown: true,
      nullAgeNotZero: true,
      recoveredIncident: true,
      metadataOnlyReceipts: true,
    });
    progress("operations-role-revoke-await");
    await command("operations-revoked");
    const previousDenied = { ...forbidden };
    progress("operations-api403-maintenance");
    await maintenance.bringToFront();
    await maintenanceCard.getByRole("button", { name: "Refresh", exact: true }).click();
    await until(
      () =>
        !invalid &&
        ["operations.observations", "operations.sources"].every(
          (name) => forbidden[name] > previousDenied[name],
        ),
    );
    progress("operations-api403-logs");
    await logs.bringToFront();
    await logsCard.getByRole("button", { name: "Refresh", exact: true }).click();
    const deniedMessage = "Operations data is available only to a current active administrator.";
    await until(
      async () =>
        !invalid &&
        reads.every((name) => forbidden[name] > previousDenied[name]) &&
        (await text(maintenanceCard, deniedMessage)) &&
        (await text(logsCard, deniedMessage)),
    );
    fail(
      (await maintenanceCard.locator("article,code,dl,section").count()) === 0 &&
        (await logsCard.locator("article,code,dl,section").count()) === 0,
      "Private cached operations facts survived API403",
    );
    progress("operations-denied-mounted");
    await retained();
    emit("operations-denied", {
      api403Both: true,
      allPrivateSectionsHidden: true,
      mountedDocuments: true,
    });
    progress("operations-regrant-await");
    await command("operations-regranted");
    progress("operations-regrant-hold");
    // Cross the real 60-second polling interval without fake clocks or intercepted reads.
    const requestBaseline = operationRequests;
    const holdStarted = performance.now();
    await until(async () => {
      fail(
        !invalid &&
          operationRequests === requestBaseline &&
          (await text(maintenanceCard, deniedMessage)) &&
          (await text(logsCard, deniedMessage)) &&
          (await maintenanceCard.locator("article,code,dl,section").count()) === 0 &&
          (await logsCard.locator("article,code,dl,section").count()) === 0,
        "Operations automatically restored or retried after authorization refusal",
      );
      return performance.now() - holdStarted >= 65000;
    }, 70000);
    const regrantIdleWindowMs = Math.floor(performance.now() - holdStarted);
    async function deniedAfterResume(page, card) {
      const beforeResume = operationRequests;
      await page.bringToFront();
      const resumed = performance.now();
      await until(async () => {
        fail(
          !invalid &&
            operationRequests === beforeResume &&
            (await text(card, deniedMessage)) &&
            (await card.locator("article,code,dl,section").count()) === 0,
          "Operations resumed automatically before explicit Refresh",
        );
        return performance.now() - resumed >= 1000;
      }, 3000);
    }
    const previousAccepted = { ...accepted };
    progress("operations-resume-maintenance");
    await deniedAfterResume(maintenance, maintenanceCard);
    progress("operations-refresh-maintenance");
    await maintenanceCard.getByRole("button", { name: "Refresh", exact: true }).click();
    await until(
      () =>
        !invalid &&
        ["operations.observations", "operations.sources"].every(
          (name) => accepted[name] > previousAccepted[name],
        ),
    );
    progress("operations-resume-logs");
    await deniedAfterResume(logs, logsCard);
    progress("operations-refresh-logs");
    await logsCard.getByRole("button", { name: "Refresh", exact: true }).click();
    await until(
      async () =>
        reads.every((name) => accepted[name] > previousAccepted[name]) &&
        (await initialFacts()) &&
        (await text(
          incidents
            .locator("article")
            .filter({ has: logs.getByText("component:web", { exact: true }) }),
          "Recovered",
        )),
    );
    progress("operations-restored-mounted");
    await retained();
    emit("operations-restored", {
      explicitRefreshBoth: true,
      currentAdminReads: true,
      noAutomaticRestoration: true,
      boardRetained: true,
    });
    return {
      nativeAdminPasswordLogin: true,
      nativeAdminMfa: true,
      realRepositoryFacts: true,
      maintenanceFields: true,
      staleAndUnknown: true,
      sourceEnrollmentDistinction: true,
      nullAgeNotZero: true,
      recoveredIncident: true,
      metadataOnlyReceipts: true,
      mounted403HiddenBoth: true,
      explicitRefreshRestoredBoth: true,
      noAutomaticRestoration: true,
      boardRetained: true,
      regrantIdleWindowMs,
      forbiddenResponses: Object.values(forbidden).reduce((sum, count) => sum + count, 0),
      readResponses: Object.values(accepted).reduce((sum, count) => sum + count, 0),
    };
  } finally {
    await context.close();
    await Promise.allSettled(observing);
  }
}
