// Keep one real authenticated tab and an unsaved Activity open across a fixture Caddy reload.
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { verifySdkKeyboardHelp } from "./deployment/web_sdk_keyboard_fixture.mjs";

const GENERATION = "x-warpdrive-fixture-web-generation";
const IDENTITY_PATH = "/api/runtime/web-identity";
const REVISION = /^[a-f0-9]{40}$/u;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const LABEL = /^[a-zA-Z0-9 _-]{1,100}$/u;
const REPEAT_SCENARIO = "warpdrive-web-continuity-v2";
const CRM_SWITCH = "crm-switch";
export const ROLLOUT_TIMING = Object.freeze({ total: 180000, armed: 45000, switched: 15000 });
const FAILURE_REASONS = new Set([
  "control-invalid",
  "control-eof",
  "command-timeout",
  "page-error",
  "external-request",
  "external-socket",
  "draft-navigation-changed",
  "draft-node-replaced",
  "draft-value-changed",
  "baseline-socket-changed",
  "global-deadline",
  "unclassified-proof-failure",
]);
const FAILURE_STAGES = new Set([
  "profile",
  "browser-start",
  "native-login-and-draft",
  "coordinator-preflight",
  "pre-switch-socket",
  "waiting-for-switch",
  "persistent-reconnect",
  "old-tab-server-action",
  "current-rendered-presentation",
  "current-keyboard-help",
  "current-crm-switch",
  "browser-close",
]);

export class RolloutProofError extends Error {
  constructor(reason) {
    super("Required browser rollout evidence is unavailable");
    this.reason = FAILURE_REASONS.has(reason) ? reason : "unclassified-proof-failure";
  }
}

function requireProof(condition, reason = "unclassified-proof-failure") {
  if (!condition) throw new RolloutProofError(reason);
}

export function failureRecord(stage, error, elapsedMs, phaseElapsedMs) {
  const bounded = (value) =>
    Number.isFinite(value) ? Math.min(3600000, Math.max(0, Math.floor(value))) : 0;
  return {
    event: "browser.web-rollout.failed",
    stage: FAILURE_STAGES.has(stage) ? stage : "profile",
    reason: error instanceof RolloutProofError ? error.reason : "unclassified-proof-failure",
    elapsedMs: bounded(elapsedMs),
    phaseElapsedMs: bounded(phaseElapsedMs),
  };
}

function readProfile() {
  const path = process.env.BROWSER_WEB_ROLLOUT_PROFILE;
  requireProof(typeof path === "string" && isAbsolute(path));
  const raw = readFileSync(path, "utf8");
  requireProof(raw.length <= 4096);
  const profile = JSON.parse(raw);
  requireProof(profile.scenario === undefined || profile.scenario === REPEAT_SCENARIO);
  requireProof(
    profile.sdkKeyboardHelp === undefined ||
      (profile.sdkKeyboardHelp === true && profile.scenario === REPEAT_SCENARIO),
  );
  requireProof(
    profile.sdkScenario === undefined ||
      (profile.sdkScenario === CRM_SWITCH &&
        profile.scenario === REPEAT_SCENARIO &&
        profile.sdkKeyboardHelp === true),
  );
  const gaps = profile.topBarGaps ?? [24, 22];
  requireProof(
    profile.topBarGaps === undefined ||
      (profile.scenario === undefined &&
        Array.isArray(gaps) &&
        gaps.length === 2 &&
        gaps.every((gap) => Number.isSafeInteger(gap) && gap >= 0 && gap <= 64) &&
        gaps[0] - gaps[1] === 2),
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

export function switchControl(
  stream,
  {
    now = () => performance.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {},
) {
  const input = createInterface({ input: stream });
  const commands = ["arm-pre-switch", "pre-switch", "switched"];
  let next = 0;
  const startedAt = now();
  /** @type {{ expected: string | null, received: boolean, invalid: boolean, ended: boolean }} */
  const state = { expected: null, received: false, invalid: false, ended: false };
  input.on("line", (line) => {
    try {
      requireProof(
        state.expected !== null && !state.received && line.length <= 128,
        "control-invalid",
      );
      requireProof(
        /^\{\s*"command"\s*:\s*"(?:arm-pre-switch|pre-switch|switched)"\s*\}$/u.test(line),
        "control-invalid",
      );
      const value = JSON.parse(line);
      requireProof(
        Object.keys(value).length === 1 && value.command === state.expected,
        "control-invalid",
      );
      state.received = true;
    } catch {
      state.invalid = true;
    }
  });
  input.on("close", () => {
    state.ended = true;
  });
  function guard() {
    requireProof(!state.invalid, "control-invalid");
    requireProof(now() - startedAt < ROLLOUT_TIMING.total, "global-deadline");
  }
  return {
    input,
    state,
    guard,
    elapsed: () => now() - startedAt,
    expect(command) {
      guard();
      requireProof(
        command === commands[next] && state.expected === null && !state.received,
        "control-invalid",
      );
      state.expected = command;
    },
    async wait(milliseconds, observe = () => {}) {
      const end = now() + milliseconds;
      for (;;) {
        guard();
        observe();
        requireProof(!state.ended || state.received, "control-eof");
        requireProof(now() < end, "command-timeout");
        if (state.received) {
          state.expected = null;
          state.received = false;
          next++;
          return;
        }
        await sleep(50);
      }
    },
  };
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

export async function runBrowserRollout() {
  const metrics = { blockedRequests: 0, blockedSockets: 0, pageErrors: 0 };
  const control = switchControl(process.stdin);
  const emit = (phase, detail) => console.log(JSON.stringify({ phase, ...detail }));
  let stage = "profile";
  let phaseStartedAt = performance.now();
  const setStage = (value) => {
    stage = value;
    phaseStartedAt = performance.now();
  };
  const diagnostic = (error) =>
    failureRecord(stage, error, control.elapsed(), performance.now() - phaseStartedAt);
  let browser;

  function guard() {
    control.guard();
    requireProof(metrics.pageErrors === 0, "page-error");
    requireProof(metrics.blockedRequests === 0, "external-request");
    requireProof(metrics.blockedSockets === 0, "external-socket");
  }

  async function until(predicate, milliseconds) {
    const end = performance.now() + milliseconds;
    for (;;) {
      guard();
      requireProof(performance.now() < end, "command-timeout");
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function waitForCommand(milliseconds) {
    await control.wait(milliseconds, guard);
  }

  function topBarGap(page) {
    return page.locator("[data-app-topbar]").evaluate((element) => getComputedStyle(element).gap);
  }

  const deadline = setTimeout(() => {
    console.error(JSON.stringify(diagnostic(new RolloutProofError("global-deadline"))));
    process.exit(2);
  }, ROLLOUT_TIMING.total);

  try {
    const profile = readProfile();
    setStage("browser-start");
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
        return {
          ...state,
          connections: state.connections.map((connection) => ({ ...connection })),
        };
      });
    const subscribed = (socket) => socket.open && socket.auth && socket.user && socket.pipeline;

    setStage("native-login-and-draft");
    await page.goto(`${profile.base}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[name="email"]').fill(profile.email);
    await page.locator('input[name="password"]').fill(profile.password);
    await page.locator('button[type="submit"]').click();
    const board = page.getByRole("main", { name: `Board ${profile.pipelineName}`, exact: true });
    await board.waitFor({ state: "visible" });
    if (profile.scenario !== REPEAT_SCENARIO)
      await until(async () => (await topBarGap(page)) === `${profile.topBarGaps[0]}px`, 10000);
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
      requireProof(
        page.url() === oldUrl && traffic.navigations === oldNavigations,
        "draft-navigation-changed",
      );
      requireProof(
        await boardMount.evaluate((element) => element.isConnected),
        "draft-node-replaced",
      );
      requireProof(
        await draftMount.evaluate((element) => element.isConnected),
        "draft-node-replaced",
      );
      requireProof((await subject.inputValue()) === profile.activitySubject, "draft-value-changed");
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
    control.expect("arm-pre-switch");
    emit("initial-ready", {
      oldStatic: true,
      nativeLogin: true,
      draftReady: true,
      subscribed: true,
    });

    // Controller health preflight is separate from the short armed handshake.
    // The original overall deadline remains active throughout this wait.
    setStage("coordinator-preflight");
    await waitForCommand(ROLLOUT_TIMING.total);
    control.expect("pre-switch");
    emit("pre-switch-armed", {});
    setStage("pre-switch-socket");
    await waitForCommand(ROLLOUT_TIMING.armed);
    await verifyDraft();
    const beforeSwitch = await socketState();
    requireProof(
      beforeSwitch.active === 1 &&
        beforeSwitch.maxActive === 1 &&
        beforeSwitch.violations === 0 &&
        beforeSwitch.connections.some(
          (socket) => socket.id === initialSocket.id && subscribed(socket),
        ),
      "baseline-socket-changed",
    );
    control.expect("switched");
    emit("pre-switch-ready", { oldSocketActive: true });

    setStage("waiting-for-switch");
    await waitForCommand(ROLLOUT_TIMING.switched);
    setStage("persistent-reconnect");
    await until(async () => {
      requireProof(
        page.url() === oldUrl && traffic.navigations === oldNavigations,
        "draft-navigation-changed",
      );
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

    setStage("old-tab-server-action");
    traffic.savePath = new URL(oldUrl).pathname;
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await until(() => {
      requireProof(traffic.actionPosts <= 1);
      return traffic.actionOk && traffic.finishedAt !== 0;
    }, 20000);
    // The normal success refresh may load the current Web document after the old action finishes.
    await dialog.waitFor({ state: "hidden" });
    await until(() => Date.now() - traffic.finishedAt >= 750, 3000);

    setStage("current-rendered-presentation");
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
    if (profile.scenario !== REPEAT_SCENARIO)
      await until(async () => (await topBarGap(fresh)) === `${profile.topBarGaps[1]}px`, 10000);
    requireProof(fresh.url() === oldUrl);
    requireProof(traffic.actionPosts === 1);

    let sdkKeyboardHelp;
    if (profile.sdkKeyboardHelp === true) {
      setStage("current-keyboard-help");
      sdkKeyboardHelp = await verifySdkKeyboardHelp(fresh);
    }

    let sdkSwitch;
    if (profile.sdkScenario === CRM_SWITCH) {
      setStage("current-crm-switch");
      const { verifySdkSwitch } = await import("./deployment/web_sdk_switch_fixture.mjs");
      sdkSwitch = await verifySdkSwitch(fresh, { sourceRevision: profile.currentRevision });
    }

    setStage("browser-close");
    await browser.close();
    browser = undefined;
    guard();
    emit("complete", {
      freshTicket: true,
      resubscribed: true,
      persistentDraft: true,
      oldAction: true,
      actionPosts: 1,
      ...(profile.scenario === REPEAT_SCENARIO ? { freshStampedPage: true } : {}),
      ...(sdkKeyboardHelp === undefined ? {} : { sdkKeyboardHelp }),
      ...(sdkSwitch === undefined ? {} : { sdkSwitch }),
    });
  } catch (error) {
    console.error(JSON.stringify(diagnostic(error)));
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runBrowserRollout();
}
