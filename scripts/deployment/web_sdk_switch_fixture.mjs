/** Exercise the real CRM Switch through a confined, already authenticated candidate page. */
import { decodePreferenceResult } from "../browser-workflow-preference-actions.mjs";

const PATH = "/settings/workflow";
const LABEL = "Play a coins sound after every won deal";
const HEADER = "x-warpdrive-fixture-web-generation";
const REVISION = /^[a-f0-9]{40}$/u;
const ACTION_ID = /^[a-f0-9]{42}$/u;

function requireProof(condition) {
  if (!condition) throw Error("Required CRM Switch browser evidence is unavailable");
}

function readTarget(page, sourceRevision, timeout) {
  const origin = new URL(page.url());
  requireProof(
    origin.protocol === "https:" &&
      origin.hostname === "127.0.0.1" &&
      Boolean(origin.port) &&
      !origin.username &&
      !origin.password &&
      REVISION.test(sourceRevision) &&
      Number.isSafeInteger(timeout) &&
      timeout > 0 &&
      timeout <= 15000,
  );
  return new URL(PATH, origin);
}

function verifyDocument(response, page, target, generation) {
  requireProof(response?.status() === 200 && page.url() === target.href);
  requireProof(response.headers()[HEADER] === generation);
}

function isAction(request, target) {
  return (
    request.method() === "POST" &&
    request.url() === target.href &&
    Boolean(request.headers()["next-action"])
  );
}

function checkActionRequest(request, generation) {
  const headers = request.headers();
  requireProof(ACTION_ID.test(headers["next-action"]) && headers["x-deployment-id"] === generation);
  const body = request.postData();
  requireProof(typeof body === "string" && body.length <= 65_536);
  const args = JSON.parse(body);
  requireProof(Array.isArray(args) && args.length === 2);
  const [input, csrf] = args;
  requireProof(
    input &&
      typeof input === "object" &&
      Object.keys(input).sort().join(",") === "key,value" &&
      input.key === "winSound" &&
      input.value === true &&
      typeof csrf === "string" &&
      csrf.length > 0,
  );
}

async function waitForFocusedSwitch(page, control, timeout) {
  await control.focus({ timeout });
  const handle = await control.elementHandle({ timeout });
  try {
    await page.waitForFunction((element) => document.activeElement === element, handle, {
      timeout,
    });
  } finally {
    await handle.dispose();
  }
}

/** The old-tab Activity is counted elsewhere. This fresh page toggles one synthetic preference. */
export async function verifySdkSwitch(page, { sourceRevision, timeout = 8000 }) {
  const target = readTarget(page, sourceRevision, timeout);
  const generation = `wd-${sourceRevision}`;
  const navigation = { waitUntil: "domcontentloaded", timeout };
  verifyDocument(await page.goto(target.href, navigation), page, target, generation);
  const selector = '[role="switch"][aria-checked="true"]';
  const control = page.getByRole("switch", { name: LABEL, exact: true });
  await control.waitFor({ state: "visible", timeout });
  requireProof((await control.getAttribute("aria-checked", { timeout })) === "false");
  requireProof((await control.getAttribute("type", { timeout })) === "button");
  await waitForFocusedSwitch(page, control, timeout);

  let actionPosts = 0;
  const record = (request) => {
    if (isAction(request, target)) actionPosts++;
  };
  page.on("request", record);
  try {
    const [response] = await Promise.all([
      page.waitForResponse((reply) => isAction(reply.request(), target), {
        timeout,
      }),
      page.keyboard.press("Enter"),
    ]);
    checkActionRequest(response.request(), generation);
    requireProof(response.status() === 200 && response.headers()[HEADER] === generation);
    requireProof(decodePreferenceResult(await response.body()).ok === true);
    await control.and(page.locator(selector)).waitFor({ state: "visible", timeout });
    verifyDocument(await page.reload(navigation), page, target, generation);
    await control.and(page.locator(selector)).waitFor({ state: "visible", timeout });
    requireProof(actionPosts === 1);
    return {
      schemaVersion: 1,
      activatedByKeyboard: true,
      savedByCandidate: true,
      persistedAfterReload: true,
      actionPosts,
    };
  } finally {
    page.off("request", record);
  }
}
