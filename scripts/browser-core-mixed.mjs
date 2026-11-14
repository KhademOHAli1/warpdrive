// Keep one native authenticated tab and draft across Web switching through the real final Core image.
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";

const GENERATION = "x-warpdrive-fixture-web-generation";
const IDENTITY_PATH = "/api/runtime/web-identity";
const REVISION = /^[a-f0-9]{40}$/u;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const LABEL = /^[a-zA-Z0-9 _-]{1,100}$/u;
const TRANSITIONS = ["forward", "reverse", "reapply", "before-fault", "automatic-rollback"];

function requireProof(condition) {
  if (!condition) throw Error("Required browser rollout evidence is unavailable");
}

function readProfile() {
  const path = process.env.BROWSER_WEB_ROLLOUT_PROFILE;
  requireProof(typeof path === "string" && isAbsolute(path));
  const raw = readFileSync(path, "utf8");
  requireProof(raw.length <= 4096);
  const profile = JSON.parse(raw);
  requireProof(
    profile.scenario === undefined &&
      profile.sdkKeyboardHelp === undefined &&
      profile.sdkScenario === undefined,
  );
  const gaps = profile.topBarGaps;
  requireProof(
    Array.isArray(gaps) &&
      gaps.length === 2 &&
      gaps.every((gap) => Number.isSafeInteger(gap) && gap >= 0 && gap <= 64) &&
      gaps[0] - gaps[1] === 2,
  );
  const origin = new URL(profile.baseUrl);
  requireProof(
    origin.protocol === "https:" &&
      origin.hostname === "127.0.0.1" &&
      origin.port !== "" &&
      origin.username === "" &&
      origin.password === "" &&
      origin.pathname === "/" &&
      origin.search === "" &&
      origin.hash === "",
  );
  requireProof(
    [profile.previousRevision, profile.currentRevision].every(
      (revision) => typeof revision === "string" && REVISION.test(revision),
    ) && profile.previousRevision !== profile.currentRevision,
  );
  requireProof(
    [profile.actorId, profile.pipelineId].every((id) => typeof id === "string" && UUID.test(id)) &&
      [profile.pipelineName, profile.activitySubject].every(
        (label) => typeof label === "string" && LABEL.test(label),
      ) &&
      typeof profile.email === "string" &&
      /^[a-z0-9._+-]{1,80}@example\.invalid$/u.test(profile.email) &&
      typeof profile.password === "string" &&
      profile.password.length >= 20 &&
      profile.password.length <= 128,
  );
  return { ...profile, topBarGaps: gaps, base: origin.origin, wsUrl: `wss://${origin.host}/_ws` };
}

function switchControl() {
  const input = createInterface({ input: process.stdin });
  /** @type {{ expected: string | null, received: boolean, invalid: boolean, ended: boolean }} */
  const state = { expected: null, received: false, invalid: false, ended: false };
  input.on("line", (line) => {
    try {
      requireProof(state.expected !== null && !state.received && line.length <= 128);
      const value = JSON.parse(line);
      requireProof(Object.keys(value).length === 1 && value.command === state.expected);
      state.received = true;
    } catch {
      state.invalid = true;
    }
  });
  input.on("close", () => {
    state.ended = true;
  });
  return { input, state };
}

async function observeRealSockets(context, { wsUrl, actorId, pipelineId }) {
  await context.addInitScript(
    ({ allowed, actor, pipeline }) => {
      const state = { connections: [], active: 0, maxActive: 0, violations: 0 };
      Object.defineProperty(window, "__warpdriveWebRollout", { value: state });
      const Original = window.WebSocket;
      window.WebSocket = new Proxy(Original, {
        construct(target, args) {
          if (new URL(String(args[0]), window.location.href).href !== allowed) {
            state.violations++;
            throw Error("Unapproved realtime target");
          }
          if (state.connections.length >= 64) {
            state.violations++;
            throw Error("Realtime connection budget exceeded");
          }
          const socket = Reflect.construct(target, args, target);
          const connection = {
            id: state.connections.length + 1,
            closed: false,
            get open() {
              return socket.readyState === Original.OPEN;
            },
            auth: false,
            user: false,
            pipeline: false,
          };
          state.connections.push(connection);
          state.active++;
          state.maxActive = Math.max(state.maxActive, state.active);
          socket.addEventListener(
            "close",
            () => {
              connection.closed = true;
              state.active--;
            },
            { once: true },
          );
          socket.addEventListener("message", (event) => {
            try {
              if (typeof event.data !== "string" || event.data.length > 32768) throw Error();
              const frame = JSON.parse(event.data);
              if (frame.kind === "auth_ok") connection.auth = true;
              if (frame.kind === "subscribed" && connection.auth) {
                if (frame.channel === `user:${actor}`) connection.user = true;
                if (frame.channel === `pipeline:${pipeline}`) connection.pipeline = true;
              }
            } catch {
              state.violations++;
            }
          });
          return socket;
        },
      });
    },
    { allowed: wsUrl, actor: actorId, pipeline: pipelineId },
  );
}

async function confinedContext(browser, profile, metrics) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: 1440, height: 1000 },
  });
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== profile.base) {
      metrics.blockedRequests++;
      await route.abort();
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket("**/*", (route) => {
    if (route.url() === profile.wsUrl) {
      route.connectToServer();
      return;
    }
    metrics.blockedSockets++;
    void route.close({ code: 1008 });
  });
  await observeRealSockets(context, profile);
  return context;
}

function recordOldAsset(traffic, url, generation, previous) {
  if (
    generation !== previous ||
    !url.pathname.startsWith("/_next/static/") ||
    url.searchParams.getAll("dpl").length !== 1 ||
    url.searchParams.get("dpl") !== previous
  )
    return;
  const kind = url.pathname.endsWith(".js") ? "js" : url.pathname.endsWith(".css") ? "css" : null;
  if (kind && traffic.oldAssets[kind] === null) traffic.oldAssets[kind] = url.pathname + url.search;
}

function observePage(page, previous, metrics) {
  /** @type {{
   *   oldAssets: {js: string | null, css: string | null},
   *   oldLogin: boolean,
   *   oldTicket: boolean,
   *   freshTicket: boolean,
   *   coreTickets: number,
   *   navigations: number,
   *   savePath: string | null,
   *   actionPosts: number,
   *   action: object | null,
   *   actionOk: boolean,
   *   finishedAt: number,
   * }} */
  const traffic = {
    oldAssets: { js: null, css: null },
    oldLogin: false,
    oldTicket: false,
    freshTicket: false,
    coreTickets: 0,
    navigations: 0,
    savePath: null,
    actionPosts: 0,
    action: null,
    actionOk: false,
    finishedAt: 0,
  };
  page.on("pageerror", () => {
    metrics.pageErrors++;
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) traffic.navigations++;
  });
  page.on("request", (request) => {
    const headers = request.headers();
    if (request.method() !== "POST" || headers["next-action"] === undefined) return;
    traffic.actionPosts++;
    if (
      traffic.actionPosts === 1 &&
      traffic.savePath !== null &&
      /^[a-f0-9]{42}$/u.test(headers["next-action"]) &&
      headers["x-deployment-id"] === previous &&
      new URL(request.url()).pathname === traffic.savePath
    ) {
      traffic.action = request;
    }
  });
  page.on("response", (response) => {
    if (response.status() !== 200) return;
    const url = new URL(response.url());
    const headers = response.headers();
    const generation = headers[GENERATION];
    if (generation === previous && url.pathname === "/api/auth/sign-in/email")
      traffic.oldLogin = true;
    if (
      url.pathname.startsWith("/api/trpc/") &&
      url.pathname.slice("/api/trpc/".length).split(",").includes("realtime.ticket")
    ) {
      requireProof(generation === undefined);
      traffic.coreTickets++;
      traffic.oldTicket = true;
    }
    recordOldAsset(traffic, url, generation, previous);
    if (
      response.request() === traffic.action &&
      generation === previous &&
      headers["content-type"]?.startsWith("text/x-component")
    )
      traffic.actionOk = true;
  });
  page.on("requestfinished", (request) => {
    if (request === traffic.action) traffic.finishedAt = Date.now();
  });
  return traffic;
}

async function verifiedAssets(page, profile, oldAssets, activeAssets, revision) {
  return await page.evaluate(
    async ({ path, assets, generationHeader, revision }) => {
      const options = {
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      };
      const response = await fetch(path, options);
      const identity = await response.json();
      if (
        response.status !== 200 ||
        response.headers.get(generationHeader) !== `wd-${revision}` ||
        identity.contract !== "warpdrive.web.identity.v1" ||
        identity.component !== "web" ||
        identity.sourceRevision !== revision
      )
        return false;
      for (const { path, generation } of assets) {
        const asset = await fetch(path, options);
        if (asset.status !== 200 || asset.headers.get(generationHeader) !== generation)
          return false;
        const body = await asset.arrayBuffer();
        if (body.byteLength === 0 || body.byteLength > 4 * 1024 * 1024) return false;
      }
      const probe = await fetch("/api/trpc/version.get", {
        ...options,
        headers: { "X-Warpdrive-Core-Probe": "1" },
      });
      return probe.status === 401 && probe.headers.get("X-Warpdrive-Core-Route") === "1";
    },
    {
      path: IDENTITY_PATH,
      revision,
      generationHeader: GENERATION,
      assets: [
        ...Object.values(oldAssets).map((path) => ({
          path,
          generation: `wd-${profile.previousRevision}`,
        })),
        ...Object.values(activeAssets).map((path) => ({ path, generation: `wd-${revision}` })),
      ],
    },
  );
}

const metrics = { blockedRequests: 0, blockedSockets: 0, pageErrors: 0 };
const control = switchControl();
const emit = (phase, detail) => console.log(JSON.stringify({ phase, ...detail }));
let stage = "profile";
let browser;

function guard() {
  requireProof(!control.state.invalid && Object.values(metrics).every((value) => value === 0));
}

async function until(predicate, milliseconds) {
  const end = Date.now() + milliseconds;
  for (;;) {
    guard();
    requireProof(Date.now() < end);
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForCommand(milliseconds) {
  await until(() => {
    requireProof(!control.state.ended || control.state.received);
    return control.state.received;
  }, milliseconds);
  control.state.expected = null;
  control.state.received = false;
}

function topBarGap(page) {
  return page.locator("[data-app-topbar]").evaluate((element) => getComputedStyle(element).gap);
}

const deadline = setTimeout(() => {
  console.error('{"event":"browser.core-mixed.deadline"}');
  process.exit(2);
}, 360000);

try {
  const profile = readProfile();
  stage = "browser-start";
  const { chromium } = await import("../tools/browser-smoke/node_modules/playwright/index.mjs");
  browser = await chromium.launch({ headless: true, timeout: 15000 });
  const context = await confinedContext(browser, profile, metrics);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const traffic = observePage(page, `wd-${profile.previousRevision}`, metrics);
  const socketState = () =>
    page.evaluate(() => {
      const state = window.__warpdriveWebRollout;
      return { ...state, connections: state.connections.map((connection) => ({ ...connection })) };
    });
  const subscribed = (socket) => socket.open && socket.auth && socket.user && socket.pipeline;
  const sessionValue = async () => {
    const cookies = (await context.cookies(profile.base)).filter(
      (cookie) => cookie.name === "wd_sid",
    );
    requireProof(cookies.length === 1);
    return cookies[0].value;
  };
  async function openDraft(target, subject) {
    await target.getByRole("button", { name: "Quick add", exact: true }).click();
    await target.getByRole("menuitem", { name: /^Activity(?:\s*A)?$/u }).click();
    const dialog = target.getByRole("dialog", { name: "Add activity", exact: true });
    await dialog.getByRole("button", { name: "Task", exact: true }).click();
    const textbox = dialog.getByRole("textbox", { name: "Subject", exact: true });
    await textbox.fill(subject);
    return { dialog, textbox };
  }

  stage = "native-login-and-draft";
  await page.goto(`${profile.base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(profile.email);
  await page.locator('input[name="password"]').fill(profile.password);
  await page.locator('button[type="submit"]').click();
  const board = page.getByRole("main", { name: `Board ${profile.pipelineName}`, exact: true });
  await board.waitFor({ state: "visible" });
  await until(async () => (await topBarGap(page)) === `${profile.topBarGaps[0]}px`, 10000);
  const draftSubject = `${profile.activitySubject} draft`;
  const draft = await openDraft(page, draftSubject);
  const boardMount = await board.elementHandle();
  const draftMount = await draft.dialog.elementHandle();
  const oldUrl = page.url();
  const oldNavigations = traffic.navigations;
  const nativeSession = await sessionValue();
  async function verifyDraft() {
    requireProof(
      page.url() === oldUrl && traffic.navigations === oldNavigations && traffic.actionPosts === 0,
    );
    requireProof(await boardMount.evaluate((element) => element.isConnected));
    requireProof(await draftMount.evaluate((element) => element.isConnected));
    requireProof((await draft.textbox.inputValue()) === draftSubject);
    requireProof((await sessionValue()) === nativeSession);
  }

  // This second old-generation tab submits the sole durable action while the
  // new Web is selected. The primary old tab's original draft stays untouched.
  const actionPage = await context.newPage();
  actionPage.setDefaultTimeout(20000);
  const actionTraffic = observePage(actionPage, `wd-${profile.previousRevision}`, metrics);
  const actionDocument = await actionPage.goto(oldUrl, { waitUntil: "domcontentloaded" });
  requireProof(actionDocument?.headers()[GENERATION] === `wd-${profile.previousRevision}`);
  await actionPage
    .getByRole("main", { name: `Board ${profile.pipelineName}`, exact: true })
    .waitFor({ state: "visible" });
  const actionDraft = await openDraft(actionPage, profile.activitySubject);
  await until(async () => {
    const sockets = await socketState();
    return (
      sockets.connections.some(subscribed) &&
      sockets.maxActive === 1 &&
      sockets.violations === 0 &&
      traffic.oldAssets.js &&
      traffic.oldAssets.css &&
      traffic.oldLogin &&
      traffic.oldTicket
    );
  }, 30000);
  await verifyDraft();
  control.state.expected = "pre-forward";
  emit("initial-ready", { oldStatic: true, nativeLogin: true, draftReady: true, subscribed: true });

  async function presentation(revision) {
    const fresh = await context.newPage();
    fresh.setDefaultTimeout(20000);
    fresh.on("pageerror", () => {
      metrics.pageErrors++;
    });
    try {
      const response = await fresh.goto(oldUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      const generation = `wd-${revision}`;
      requireProof(response?.status() === 200 && response.headers()[GENERATION] === generation);
      const htmlTag = /<html(?:\s[^>]*)?>/iu.exec(await response.text())?.[0];
      requireProof(/\sdata-dpl-id="(wd-[a-f0-9]{40})"/u.exec(htmlTag ?? "")?.[1] === generation);
      await fresh
        .getByRole("main", { name: `Board ${profile.pipelineName}`, exact: true })
        .waitFor({ state: "visible" });
      const gap = profile.topBarGaps[revision === profile.previousRevision ? 0 : 1];
      await until(async () => (await topBarGap(fresh)) === `${gap}px`, 10000);
      requireProof(fresh.url() === oldUrl && (await sessionValue()) === nativeSession);
      const urls = await fresh.evaluate(() =>
        Array.from(document.querySelectorAll('script[src],link[rel="stylesheet"][href]')).map(
          (element) => element.getAttribute("src") ?? element.getAttribute("href"),
        ),
      );
      const assets = urls
        .filter((value) => typeof value === "string")
        .map((value) => new URL(value, profile.base))
        .filter(
          (url) =>
            url.origin === profile.base &&
            url.pathname.startsWith("/_next/static/") &&
            url.searchParams.get("dpl") === generation,
        );
      const js = assets.find((url) => url.pathname.endsWith(".js"));
      const css = assets.find((url) => url.pathname.endsWith(".css"));
      requireProof(js && css);
      requireProof(
        await verifiedAssets(
          page,
          profile,
          traffic.oldAssets,
          { js: js.pathname + js.search, css: css.pathname + css.search },
          revision,
        ),
      );
    } finally {
      await fresh.close();
    }
  }

  async function waitForPrimaryResubscription(socketId, ticketsBefore) {
    await until(async () => {
      await verifyDraft();
      const sockets = await socketState();
      requireProof(sockets.maxActive === 1 && sockets.violations === 0);
      return (
        sockets.active === 1 &&
        sockets.connections.find((socket) => socket.id === socketId)?.closed &&
        sockets.connections.some((socket) => socket.id > socketId && subscribed(socket)) &&
        traffic.coreTickets > ticketsBefore
      );
    }, 45000);
  }

  let finalWitness;
  for (const [index, phase] of TRANSITIONS.entries()) {
    stage = "transition-preparation";
    await waitForCommand(90000);
    await verifyDraft();
    const before = await socketState();
    const activeSocket = before.connections.find(subscribed);
    requireProof(
      before.active === 1 && before.maxActive === 1 && before.violations === 0 && activeSocket,
    );
    const ticketsBefore = traffic.coreTickets;
    control.state.expected = phase;
    emit(`before-${phase}`, {
      oldSocketActive: true,
      sameDocument: true,
      sameSession: true,
      persistentDraft: true,
    });
    stage = "waiting-for-transition";
    await waitForCommand(60000);
    stage = "persistent-transition-reconnect";
    await waitForPrimaryResubscription(activeSocket.id, ticketsBefore);
    await verifyDraft();
    if (phase === "forward") {
      stage = "old-tab-server-action";
      actionTraffic.savePath = new URL(oldUrl).pathname;
      await actionDraft.dialog.getByRole("button", { name: "Save", exact: true }).click();
      await until(() => {
        requireProof(actionTraffic.actionPosts <= 1);
        return actionTraffic.actionOk && actionTraffic.finishedAt !== 0;
      }, 20000);
      await actionDraft.dialog.waitFor({ state: "hidden" });
      await until(() => Date.now() - actionTraffic.finishedAt >= 750, 3000);
      requireProof(actionTraffic.actionPosts === 1);
      await actionPage.close();
      await verifyDraft();
    }
    const revision =
      phase === "forward" || phase === "reapply"
        ? profile.currentRevision
        : profile.previousRevision;
    stage = "transition-presentation";
    await presentation(revision);
    // Presentation checks await several network operations. Re-read the live
    // primary socket afterward, especially after both automatic-rollback PATCHes.
    await waitForPrimaryResubscription(activeSocket.id, ticketsBefore);
    finalWitness = { socketId: activeSocket.id, ticketsBefore };
    control.state.expected =
      index + 1 < TRANSITIONS.length ? `pre-${TRANSITIONS[index + 1]}` : "finish";
    emit(`after-${phase}`, {
      activeRevision: revision,
      freshCoreTicket: true,
      resubscribed: true,
      sameDocument: true,
      sameSession: true,
      persistentDraft: true,
      activePresentation: true,
      activeAndOldAssets: true,
      exactCoreRoute: true,
      oldActionPosts: 1,
    });
  }

  stage = "waiting-for-finish";
  await waitForCommand(90000);
  stage = "final-persistent-draft";
  requireProof(finalWitness);
  await waitForPrimaryResubscription(finalWitness.socketId, finalWitness.ticketsBefore);
  requireProof(actionTraffic.actionPosts === 1);
  stage = "browser-close";
  await browser.close();
  browser = undefined;
  guard();
  emit("complete", {
    freshTicket: true,
    resubscribed: true,
    persistentDraft: true,
    oldAction: true,
    actionPosts: 1,
    coreTicketsBeforeAndAfter: true,
    exactCoreRoute: true,
    freshStampedPage: true,
    transitions: TRANSITIONS.length,
    rollbackBrowserQualified: true,
    primaryDraftUnsubmitted: true,
  });
} catch {
  console.error(JSON.stringify({ event: "browser.core-mixed.failed", stage }));
  process.exitCode = 2;
} finally {
  control.input.close();
  try {
    await browser?.close();
  } catch {
    console.error('{"event":"browser.core-mixed.cleanup-failed"}');
    process.exitCode = 2;
  }
  clearTimeout(deadline);
}
