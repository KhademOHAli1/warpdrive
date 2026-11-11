// Real settings UI and native administrator reads. Retain only finite proof facts.
// No screenshots, traces, cookies, request bodies or response payload artifacts.
import { createHmac } from "node:crypto";

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
}) {
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
    invalid = false;
  const observing = new Set();
  const pages = [];
  function mfaWasVerified() {
    return nativeMfaEnrollment && nativeMfaVerified;
  }
  try {
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin !== base) {
        metrics.blockedRequests++;
        await route.abort();
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
                const fields = [
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
                fail(
                  data.items.length === 4 &&
                    data.items.every(
                      (item) =>
                        Object.keys(item).length === fields.length &&
                        fields.every((key) => Object.hasOwn(item, key)),
                    ),
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
    await maintenance.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await maintenance.locator('input[name="email"]').fill(profile.adminEmail);
    await maintenance.locator('input[name="password"]').fill(profile.adminPassword);
    await maintenance.locator('button[type="submit"]').click();
    await maintenance
      .getByRole("button", { name: "Set up authenticator", exact: true })
      .waitFor({ state: "visible", timeout: 30000 });
    await maintenance.getByLabel("Current password", { exact: true }).fill(profile.adminPassword);
    await maintenance.getByRole("button", { name: "Set up authenticator", exact: true }).click();
    const keyNode = maintenance
      .getByText("Setup key", { exact: true })
      .locator("..")
      .locator('p[dir="ltr"]');
    await keyNode.waitFor({ state: "visible" });
    let setupKey = await keyNode.textContent();
    await maintenance
      .getByLabel("Authenticator code", { exact: true })
      .fill(operationsTotp(setupKey));
    setupKey = "";
    await maintenance.getByRole("button", { name: "Verify code", exact: true }).click();
    const recovery = maintenance.getByRole("region", { name: "Recovery codes", exact: true });
    await recovery.waitFor({ state: "visible" });
    fail(
      mfaWasVerified() && (await recovery.locator("li").count()) === 10,
      "Native administrator MFA ceremony was not proven",
    );
    // Disposable synthetic account: acknowledge the UI without exporting recovery codes.
    await recovery
      .getByRole("checkbox", { name: "I have stored my recovery codes safely", exact: true })
      .check();
    await recovery.getByRole("button", { name: "Continue", exact: true }).click();
    await maintenance
      .getByRole("main", { name: `Board ${profile.pipelineName}`, exact: true })
      .waitFor({ state: "visible", timeout: 30000 });
    fail(nativeLogin, "Native administrator login response was not observed");
    await maintenance.goto(`${base}/settings/maintenance`, { waitUntil: "domcontentloaded" });
    await maintenance.bringToFront();
    await until(
      () =>
        !invalid && accepted["operations.observations"] > 0 && accepted["operations.sources"] > 0,
    );
    const logs = await context.newPage();
    observe(logs);
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
    await until(initialFacts);
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
    await command("operations-revoked");
    const previousDenied = { ...forbidden };
    await maintenance.bringToFront();
    await maintenanceCard.getByRole("button", { name: "Refresh", exact: true }).click();
    await until(
      () =>
        !invalid &&
        ["operations.observations", "operations.sources"].every(
          (name) => forbidden[name] > previousDenied[name],
        ),
    );
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
    await retained();
    emit("operations-denied", {
      api403Both: true,
      allPrivateSectionsHidden: true,
      mountedDocuments: true,
    });
    await command("operations-regranted");
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
    await deniedAfterResume(maintenance, maintenanceCard);
    await maintenanceCard.getByRole("button", { name: "Refresh", exact: true }).click();
    await until(
      () =>
        !invalid &&
        ["operations.observations", "operations.sources"].every(
          (name) => accepted[name] > previousAccepted[name],
        ),
    );
    await deniedAfterResume(logs, logsCard);
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
