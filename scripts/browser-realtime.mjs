// Persistent-tab recovery proof. No cookies, tickets, request bodies or frame payloads are retained.
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";

const profile = JSON.parse(readFileSync(process.env.BROWSER_REALTIME_PROFILE, "utf8"));
const origin = new URL(profile.baseUrl);
if (
  origin.protocol !== "https:" ||
  origin.hostname !== "127.0.0.1" ||
  !origin.port ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  !isAbsolute(profile.outputDir) ||
  !/^[a-f0-9]{40}$/.test(profile.revision || "") ||
  !profile.email?.endsWith("@example.invalid") ||
  typeof profile.password !== "string" ||
  profile.password.length < 20
) {
  throw Error("Realtime browser profile was not admitted");
}
const base = origin.origin;
const wsUrl = "wss://" + origin.host + "/_ws";
const commands = [];
let inputClosed = false;
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  try {
    if (line.length > 512) throw Error();
    const value = JSON.parse(line);
    if (!value || typeof value.command !== "string") throw Error();
    commands.push(value.command);
  } catch {
    commands.push("invalid");
  }
});
input.on("close", () => {
  inputClosed = true;
});
const emit = (phase, detail = {}) => console.log(JSON.stringify({ phase, ...detail }));
let stage = "browser-start",
  browser,
  context,
  page;
const metrics = {
  pageErrors: 0,
  blockedRequests: 0,
  blockedWebSockets: 0,
  loginResponses: 0,
  ticketRequests: 0,
  ticketResponses: 0,
  mainNavigations: 0,
  notificationRequests: 0,
};
const pending = new WeakMap();
let notificationInflight = 0,
  notificationLastFinished = 0;
const successful = {};
const deadline = setTimeout(() => {
  console.error('{"event":"browser.realtime.deadline"}');
  process.exit(2);
}, 180000);
function operations(request) {
  const url = new URL(request.url());
  if (!url.pathname.startsWith("/api/trpc/")) return [];
  return url.pathname.slice("/api/trpc/".length).split(",");
}
function fail(condition, message) {
  if (!condition) throw Error(message);
}
async function until(predicate, milliseconds = 30000) {
  const end = Date.now() + milliseconds;
  while (!(await predicate())) {
    fail(Date.now() < end, "Required browser stage timed out");
    fail(
      metrics.pageErrors === 0 && metrics.blockedRequests === 0 && metrics.blockedWebSockets === 0,
      "Browser safety/error guard failed",
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function command(expected) {
  await until(() => {
    const value = commands.shift();
    if (value === undefined) {
      fail(!inputClosed, "Realtime controller input closed");
      return false;
    }
    fail(value === expected, "Realtime browser command ordering changed");
    return true;
  }, 60000);
}
async function observation() {
  return await page.evaluate(() => window.__warpdriveRealtimeProof);
}
function notificationOps(values) {
  return values.filter((value) =>
    ["notifications.feed", "notifications.unreadCount"].includes(value),
  );
}
let baselineNavigation, baselineUrl, boardHandle, bellHandle;
async function unchanged() {
  fail(
    metrics.mainNavigations === baselineNavigation && page.url() === baselineUrl,
    "Persistent tab navigated during recovery",
  );
  fail(
    await boardHandle.evaluate((element) => element.isConnected),
    "Board was remounted during recovery",
  );
  fail(
    await bellHandle.evaluate((element) => element.isConnected),
    "Notification bell was remounted during recovery",
  );
  const state = await observation();
  fail(state.maxActive <= 1 && state.violations === 0, "Realtime observer bounds failed");
}
async function badge() {
  const text = await page
    .getByRole("button", { name: "Notifications", exact: true })
    .locator("span")
    .allTextContents();
  return text.length ? Number(text.join("").replace(/[^0-9]/g, "")) : 0;
}
async function settled(after) {
  await until(
    () =>
      notificationInflight === 0 &&
      Date.now() - notificationLastFinished >= 750 &&
      successful["notifications.feed"] >= after &&
      successful["notifications.unreadCount"] >= after,
  );
}

try {
  const { chromium } = await import("../tools/browser-smoke/node_modules/playwright/index.mjs");
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: 1440, height: 1000 },
  });
  await context.route("**/*", async (route) => {
    const requested = new URL(route.request().url());
    if (requested.origin !== base) {
      metrics.blockedRequests++;
      await route.abort();
    } else await route.continue();
  });
  await context.routeWebSocket("**/*", (route) => {
    if (route.url() !== wsUrl) {
      metrics.blockedWebSockets++;
      void route.close({ code: 1008 });
      return;
    }
    // Default forwarding is untouched: no synthetic frames, onMessage or close handlers.
    route.connectToServer();
  });
  await context.addInitScript(
    ({ allowed, actor, pipeline }) => {
      const state = {
        created: 0,
        active: 0,
        maxActive: 0,
        violations: 0,
        notificationFrames: 0,
        lastNotificationAt: 0,
        connections: [],
      };
      Object.defineProperty(window, "__warpdriveRealtimeProof", { value: state });
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
            id: ++state.created,
            auth: false,
            userAck: false,
            pipelineAck: false,
            closed: false,
            closedAt: 0,
            userAckAt: 0,
          };
          state.connections.push(connection);
          state.active++;
          state.maxActive = Math.max(state.maxActive, state.active);
          socket.addEventListener("close", () => {
            if (!connection.closed) {
              connection.closed = true;
              connection.closedAt = Date.now();
              state.active--;
            }
          });
          socket.addEventListener("message", (event) => {
            try {
              if (typeof event.data !== "string" || event.data.length > 32768) {
                state.violations++;
                return;
              }
              const frame = JSON.parse(event.data);
              if (frame.kind === "auth_ok") connection.auth = true;
              if (
                frame.kind === "subscribed" &&
                frame.channel === "user:" + actor &&
                connection.auth
              ) {
                connection.userAck = true;
                connection.userAckAt = Date.now();
              }
              if (
                frame.kind === "subscribed" &&
                frame.channel === "pipeline:" + pipeline &&
                connection.auth
              )
                connection.pipelineAck = true;
              if (
                frame.kind === "event" &&
                frame.channel === "user:" + actor &&
                frame.event?.type === "notification"
              ) {
                state.notificationFrames++;
                state.lastNotificationAt = Date.now();
              }
            } catch {
              state.violations++;
            }
          });
          return socket;
        },
      });
    },
    { allowed: wsUrl, actor: profile.actorId, pipeline: profile.pipelineId },
  );
  page = await context.newPage();
  page.on("pageerror", () => {
    metrics.pageErrors++;
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) metrics.mainNavigations++;
  });
  page.on("request", (request) => {
    const ops = operations(request);
    if (ops.includes("realtime.ticket")) metrics.ticketRequests++;
    const notice = notificationOps(ops);
    if (notice.length) {
      notificationInflight++;
      metrics.notificationRequests++;
      pending.set(request, { started: Date.now(), ops: notice });
    }
  });
  page.on("response", (response) => {
    const request = response.request();
    if (response.status() >= 200 && response.status() < 300) {
      if (new URL(response.url()).pathname === "/api/auth/sign-in/email") metrics.loginResponses++;
      if (operations(request).includes("realtime.ticket")) metrics.ticketResponses++;
    }
  });
  page.on("requestfinished", (request) => {
    const record = pending.get(request);
    if (record) {
      notificationInflight--;
      notificationLastFinished = Date.now();
      pending.delete(request);
      void request.response().then((response) => {
        if (response?.status() >= 200 && response.status() < 300)
          for (const op of record.ops) successful[op] = record.started;
      });
    }
  });
  page.on("requestfailed", (request) => {
    if (pending.has(request)) {
      notificationInflight--;
      notificationLastFinished = Date.now();
      pending.delete(request);
    }
  });
  stage = "native-login";
  await page.goto(base + "/login", { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(profile.email);
  await page.locator('input[name="password"]').fill(profile.password);
  await page.locator('button[type="submit"]').click();
  await page
    .getByRole("main", { name: "Board " + profile.pipelineName, exact: true })
    .waitFor({ state: "visible", timeout: 30000 });
  fail(metrics.loginResponses > 0, "Native password login response was not observed");
  boardHandle = await page
    .getByRole("main", { name: "Board " + profile.pipelineName, exact: true })
    .elementHandle();
  bellHandle = await page
    .getByRole("button", { name: "Notifications", exact: true })
    .elementHandle();
  baselineNavigation = metrics.mainNavigations;
  baselineUrl = page.url();
  stage = "initial-real-realtime";
  let initial;
  await until(async () => {
    const state = await observation();
    initial = state.connections.find(
      (item) => item.auth && item.userAck && item.pipelineAck && !item.closed,
    );
    return initial && metrics.ticketResponses > 0;
  });
  await settled(0);
  fail((await badge()) === 0, "Synthetic notification baseline is not empty");
  await unchanged();
  const initialTickets = metrics.ticketResponses;
  emit("initial-ready", {
    nativeLogin: true,
    realTicket: true,
    realAuth: true,
    userAndPipelineSubscribed: true,
    unread: 0,
    persistentMounts: true,
  });

  await command("offline");
  stage = "disconnect-refetch-settlement";
  let oldClosed;
  await until(async () => {
    oldClosed = (await observation()).connections.find((item) => item.id === initial.id);
    return oldClosed?.closed;
  });
  await settled(oldClosed.closedAt);
  await unchanged();
  emit("offline-refetch-settled", {
    disconnectObserved: true,
    bothNotificationQueriesCompleted: true,
    inflight: 0,
  });
  await command("offline-produced");
  stage = "offline-notice-is-unseen";
  await new Promise((resolve) => setTimeout(resolve, 1000));
  fail((await badge()) === 0, "Offline notice leaked through a late disconnect refetch");
  await unchanged();
  emit("offline-notice-hidden", { unread: 0, producedAfterDisconnectRefetch: true });

  await command("restart");
  stage = "persistent-tab-reconnect-and-resync";
  let recovered;
  await until(async () => {
    const state = await observation();
    recovered = state.connections.find(
      (item) =>
        item.id > initial.id && item.auth && item.userAck && item.pipelineAck && !item.closed,
    );
    return recovered && metrics.ticketResponses > initialTickets;
  }, 60000);
  await until(async () => (await badge()) === 1, 30000);
  await settled(recovered.userAckAt);
  await unchanged();
  const recoveredFrames = (await observation()).notificationFrames;
  emit("missed-notice-recovered", {
    freshRealTicket: true,
    realReauth: true,
    userAndPipelineResubscribed: true,
    unread: 1,
    ackRefetchCompleted: true,
    persistentMounts: true,
  });
  await command("online-produced");
  stage = "resumed-live-relay";
  await until(
    async () => (await observation()).notificationFrames > recoveredFrames && (await badge()) === 2,
  );
  const liveFrameAt = (await observation()).lastNotificationAt;
  await settled(liveFrameAt);
  await unchanged();
  fail(
    metrics.pageErrors === 0 && metrics.blockedRequests === 0 && metrics.blockedWebSockets === 0,
    "Browser error/isolation proof failed",
  );
  stage = "visible-notice-verification";
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await page.getByText(profile.offlineTitle, { exact: false }).waitFor({ state: "visible" });
  await page.getByText(profile.onlineTitle, { exact: false }).waitFor({ state: "visible" });
  await unchanged();
  await page.screenshot({
    path: join(profile.outputDir, "realtime-recovered.png"),
    fullPage: false,
  });
  const observed = await observation();
  const result = {
    schemaVersion: 1,
    success: true,
    revision: profile.revision,
    nativePasswordLogin: true,
    persistentDocumentAndMounts: true,
    freshRealTicketAndAuth: true,
    missedNoticeRecoveredAfterAckRefetch: true,
    resumedRealNotificationFrame: true,
    unread: 2,
    maxActiveSockets: observed.maxActive,
    metrics,
    notificationFrameCount: observed.notificationFrames,
    limitations: [
      "Synthetic nonadmin password identity; no MFA ceremony or old/new release compatibility qualification.",
      "Self-signed isolated TLS fixture; no public ingress/provider acceptance.",
    ],
  };
  writeFileSync(join(profile.outputDir, "browser.json"), JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
  });
  emit("complete", {
    nativePasswordLogin: true,
    persistentMounts: true,
    missedNoticeRecovered: true,
    liveRelayResumed: true,
    unread: 2,
    maxActiveSockets: observed.maxActive,
    pageErrors: metrics.pageErrors,
  });
} catch {
  writeFileSync(
    join(profile.outputDir, "browser.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        success: false,
        revision: profile.revision,
        stage,
        failure: "Required persistent-tab realtime stage failed",
        metrics,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.error(JSON.stringify({ event: "browser.realtime.failed", stage }));
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {
    process.exitCode = 1;
  });
  await browser?.close().catch(() => {
    process.exitCode = 1;
  });
  input.close();
  clearTimeout(deadline);
}
