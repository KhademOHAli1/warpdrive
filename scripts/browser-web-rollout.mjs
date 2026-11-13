// Keep one real authenticated tab and an unsaved Activity open across a fixture Caddy reload.
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";

const GENERATION = "x-warpdrive-fixture-web-generation";
const IDENTITY_PATH = "/api/runtime/web-identity";
const REVISION = /^[a-f0-9]{40}$/u;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const LABEL = /^[a-zA-Z0-9 _-]{1,100}$/u;

function requireProof(condition) {
  if (!condition) throw Error("Required browser rollout evidence is unavailable");
}

function readProfile() {
  const path = process.env.BROWSER_WEB_ROLLOUT_PROFILE;
  requireProof(typeof path === "string" && isAbsolute(path));
  const raw = readFileSync(path, "utf8");
  requireProof(raw.length <= 4096);
  const profile = JSON.parse(raw);
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
  return { ...profile, base: origin.origin, wsUrl: `wss://${origin.host}/_ws` };
}

function switchControl() {
  const input = createInterface({ input: process.stdin });
  /** @type {{ expected: "pre-switch" | "switched" | null, received: boolean, invalid: boolean, ended: boolean }} */
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

function observePage(page, previous, current, metrics) {
  /** @type {{
   *   oldAsset: string | null,
   *   oldLogin: boolean,
   *   oldTicket: boolean,
   *   freshTicket: boolean,
   *   navigations: number,
   *   savePath: string | null,
   *   actionPosts: number,
   *   action: object | null,
   *   actionOk: boolean,
   *   finishedAt: number,
   * }} */
  const traffic = {
    oldAsset: null,
    oldLogin: false,
    oldTicket: false,
    freshTicket: false,
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
    if (
      traffic.savePath === null ||
      request.method() !== "POST" ||
      headers["next-action"] === undefined
    )
      return;
    traffic.actionPosts++;
    if (
      traffic.actionPosts === 1 &&
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
      if (generation === previous) traffic.oldTicket = true;
      if (generation === current) traffic.freshTicket = true;
    }
    if (
      generation === previous &&
      traffic.oldAsset === null &&
      url.pathname.startsWith("/_next/static/") &&
      url.searchParams.getAll("dpl").length === 1 &&
      url.searchParams.get("dpl") === previous
    ) {
      traffic.oldAsset = url.pathname + url.search;
    }
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

async function verifiedCurrentAndOldAsset(page, profile, asset) {
  return await page.evaluate(
    async ({ path, oldAsset, revision, generationHeader, previous }) => {
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
      const prior = await fetch(oldAsset, options);
      if (prior.status !== 200 || prior.headers.get(generationHeader) !== previous) return false;
      // A successful read of one real old asset proves it is still available after the PATCH.
      const body = await prior.arrayBuffer();
      return body.byteLength > 0;
    },
    {
      path: IDENTITY_PATH,
      oldAsset: asset,
      revision: profile.currentRevision,
      generationHeader: GENERATION,
      previous: `wd-${profile.previousRevision}`,
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
  console.error('{"event":"browser.web-rollout.deadline"}');
  process.exit(2);
}, 180000);

try {
  const profile = readProfile();
  stage = "browser-start";
  const { chromium } = await import("../tools/browser-smoke/node_modules/playwright/index.mjs");
  browser = await chromium.launch({ headless: true, timeout: 15000 });
  const context = await confinedContext(browser, profile, metrics);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const traffic = observePage(
    page,
    `wd-${profile.previousRevision}`,
    `wd-${profile.currentRevision}`,
    metrics,
  );
  const socketState = () =>
    page.evaluate(() => {
      const state = window.__warpdriveWebRollout;
      return { ...state, connections: state.connections.map((connection) => ({ ...connection })) };
    });
  const subscribed = (socket) => socket.open && socket.auth && socket.user && socket.pipeline;

  stage = "native-login-and-draft";
  await page.goto(`${profile.base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(profile.email);
  await page.locator('input[name="password"]').fill(profile.password);
  await page.locator('button[type="submit"]').click();
  const board = page.getByRole("main", { name: `Board ${profile.pipelineName}`, exact: true });
  await board.waitFor({ state: "visible" });
  await until(async () => (await topBarGap(page)) === "24px", 10000);
  await page.getByRole("button", { name: "Quick add", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Activity(?:\s*A)?$/u }).click();
  const dialog = page.getByRole("dialog", { name: "Add activity", exact: true });
  await dialog.getByRole("button", { name: "Task", exact: true }).click();
  const subject = dialog.getByRole("textbox", { name: "Subject", exact: true });
  await subject.fill(profile.activitySubject);
  const boardMount = await board.elementHandle();
  const draftMount = await dialog.elementHandle();
  const oldUrl = page.url();
  const oldNavigations = traffic.navigations;
  async function verifyDraft() {
    requireProof(page.url() === oldUrl && traffic.navigations === oldNavigations);
    requireProof(await boardMount.evaluate((element) => element.isConnected));
    requireProof(await draftMount.evaluate((element) => element.isConnected));
    requireProof((await subject.inputValue()) === profile.activitySubject);
  }
  let initialSocket;
  await until(async () => {
    const sockets = await socketState();
    initialSocket = sockets.connections.find(subscribed);
    return (
      initialSocket &&
      sockets.maxActive === 1 &&
      sockets.violations === 0 &&
      traffic.oldAsset &&
      traffic.oldLogin &&
      traffic.oldTicket
    );
  }, 30000);
  control.state.expected = "pre-switch";
  emit("initial-ready", { oldStatic: true, nativeLogin: true, draftReady: true, subscribed: true });

  stage = "pre-switch-socket";
  await waitForCommand(45000);
  await verifyDraft();
  const beforeSwitch = await socketState();
  requireProof(
    beforeSwitch.active === 1 &&
      beforeSwitch.maxActive === 1 &&
      beforeSwitch.violations === 0 &&
      beforeSwitch.connections.some(
        (socket) => socket.id === initialSocket.id && subscribed(socket),
      ),
  );
  control.state.expected = "switched";
  emit("pre-switch-ready", { oldSocketActive: true });

  stage = "waiting-for-switch";
  await waitForCommand(15000);
  stage = "persistent-reconnect";
  await until(async () => {
    requireProof(page.url() === oldUrl && traffic.navigations === oldNavigations);
    const sockets = await socketState();
    requireProof(sockets.maxActive <= 1 && sockets.violations === 0);
    return (
      sockets.connections.find((socket) => socket.id === initialSocket.id)?.closed &&
      sockets.connections.some((socket) => socket.id > initialSocket.id && subscribed(socket)) &&
      traffic.freshTicket
    );
  }, 45000);
  requireProof(await verifiedCurrentAndOldAsset(page, profile, traffic.oldAsset));
  await verifyDraft();

  stage = "old-tab-server-action";
  traffic.savePath = new URL(oldUrl).pathname;
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await until(() => {
    requireProof(traffic.actionPosts <= 1);
    return traffic.actionOk && traffic.finishedAt !== 0;
  }, 20000);
  // The normal success refresh may load the current Web document after the old action finishes.
  await dialog.waitFor({ state: "hidden" });
  await until(() => Date.now() - traffic.finishedAt >= 750, 3000);

  stage = "current-rendered-presentation";
  const fresh = await context.newPage();
  fresh.setDefaultTimeout(20000);
  fresh.on("pageerror", () => {
    metrics.pageErrors++;
  });
  const documentResponse = await fresh.goto(oldUrl, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  const current = `wd-${profile.currentRevision}`;
  requireProof(
    documentResponse?.status() === 200 && documentResponse.headers()[GENERATION] === current,
  );
  // Next strips the stamp from the live DOM during hydration. Inspect the delivered HTML.
  const htmlTag = /<html(?:\s[^>]*)?>/iu.exec(await documentResponse.text())?.[0];
  requireProof(/\sdata-dpl-id="(wd-[a-f0-9]{40})"/u.exec(htmlTag ?? "")?.[1] === current);
  await fresh
    .getByRole("main", { name: `Board ${profile.pipelineName}`, exact: true })
    .waitFor({ state: "visible" });
  await until(async () => (await topBarGap(fresh)) === "22px", 10000);
  requireProof(fresh.url() === oldUrl);
  requireProof(traffic.actionPosts === 1);

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
  });
} catch {
  console.error(JSON.stringify({ event: "browser.web-rollout.failed", stage }));
  process.exitCode = 2;
} finally {
  control.input.close();
  try {
    await browser?.close();
  } catch {
    console.error('{"event":"browser.web-rollout.cleanup-failed"}');
    process.exitCode = 2;
  }
  clearTimeout(deadline);
}
