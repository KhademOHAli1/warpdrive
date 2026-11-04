// The browser only delays genuine action responses. It never manufactures a server result.
const failure = (message) => new Error(`Appearance action probe: ${message}`);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) =>
  object(value) && Object.keys(value).sort().join(",") === keys.join(",");

function invalidFlight() {
  throw failure("unsupported or malformed Flight action result");
}

function readHex(reader, delimiter) {
  const { bytes, decoder } = reader;
  const start = reader.offset;
  while (
    reader.offset < bytes.length &&
    bytes[reader.offset] !== delimiter &&
    reader.offset - start <= 8
  )
    reader.offset += 1;
  if (reader.offset >= bytes.length || reader.offset === start || reader.offset - start > 8) {
    invalidFlight();
  }
  const hex = decoder.decode(bytes.subarray(start, reader.offset));
  if (!/^[0-9a-f]+$/.test(hex)) invalidFlight();
  reader.offset += 1;
  return Number.parseInt(hex, 16);
}

const lengthTags = new Set("TAOobUSsLlGgMmV");

function readFlightRecord(reader) {
  const { bytes, decoder, models } = reader;
  const id = readHex(reader, 58);
  const first = bytes[reader.offset];
  if (first === undefined) invalidFlight();
  const tag = String.fromCharCode(first);
  if (lengthTags.has(tag)) {
    reader.offset += 1;
    const length = readHex(reader, 44);
    if (reader.offset + length > bytes.length) invalidFlight();
    reader.offset += length;
    return;
  }
  const newline = bytes.indexOf(10, reader.offset);
  if (newline < reader.offset) invalidFlight();
  const tagged = (first >= 65 && first <= 90) || tag === "#" || tag === "r" || tag === "x";
  if (!tagged) {
    if (models.has(id)) invalidFlight();
    try {
      models.set(id, JSON.parse(decoder.decode(bytes.subarray(reader.offset, newline))));
    } catch {
      invalidFlight();
    }
  }
  reader.offset = newline + 1;
}

function flightModels(bytes) {
  const reader = {
    bytes,
    offset: 0,
    decoder: new TextDecoder("utf-8", { fatal: true }),
    models: new Map(),
  };
  let records = 0;
  while (reader.offset < bytes.length) {
    records += 1;
    if (records > 4_096) invalidFlight();
    readFlightRecord(reader);
  }
  return reader.models;
}

function resolveModel(models, initial) {
  let value = initial;
  const visited = new Set();
  for (let hop = 0; hop < 8; hop += 1) {
    if (typeof value !== "string") return value;
    const reference = /^\$(?:@)?([0-9a-f]+)$/.exec(value);
    if (!reference) invalidFlight();
    const id = Number.parseInt(reference[1], 16);
    if (visited.has(id) || !models.has(id)) invalidFlight();
    visited.add(id);
    value = models.get(id);
  }
  return invalidFlight();
}

export function decodePreferenceResult(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 2_097_152) invalidFlight();
  const models = flightModels(bytes);
  const root = models.get(0);
  if (!object(root) || !Object.hasOwn(root, "a")) invalidFlight();
  const result = resolveModel(models, root.a);
  if (exactKeys(result, ["ok"]) && result.ok === true) return { ok: true };
  if (exactKeys(result, ["error", "ok"]) && result.ok === false) {
    const error = resolveModel(models, result.error);
    if (exactKeys(error, ["id"]) && typeof error.id === "string") {
      return { ok: false, error: { id: error.id } };
    }
  }
  return invalidFlight();
}

function preferenceInput(request) {
  const body = request.postData();
  if (!body || body.length > 65_536) throw failure("unsupported preference action encoding");
  let arguments_;
  try {
    arguments_ = JSON.parse(body);
  } catch {
    throw failure("unsupported preference action encoding");
  }
  if (!Array.isArray(arguments_) || arguments_.length !== 2) {
    throw failure("unsupported preference action arguments");
  }
  const input = arguments_[0];
  if (exactKeys(input, ["appearance"]) && ["day", "night", "system"].includes(input.appearance)) {
    return { kind: "appearance", value: input.appearance };
  }
  if (exactKeys(input, ["density"]) && ["comfortable", "compact"].includes(input.density)) {
    return { kind: "density", value: input.density };
  }
  throw failure("unsupported preference action input");
}

function isPreferenceRequest(request, target) {
  const url = new URL(request.url());
  return (
    request.method() === "POST" &&
    Boolean(request.headers()["next-action"]) &&
    url.origin === target.origin &&
    url.pathname === target.pathname
  );
}

function expectedInput(request, hold, closing) {
  if (closing || !hold) throw failure("an unscheduled preference action was blocked");
  const input = preferenceInput(request);
  if (input.kind !== hold.kind || input.value !== hold.value) {
    throw failure("observed preference differs from the expected action");
  }
  return input;
}

async function genuineOutcome(upstream, hold) {
  const outcome = decodePreferenceResult(await upstream.body());
  if (upstream.status() !== 200 || outcome.ok !== hold.ok) {
    throw failure("genuine action outcome differs from the expected result");
  }
  if (!hold.ok && outcome.error.id !== "E_AUTH_CSRF") {
    throw failure("genuine denial was not CSRF enforcement");
  }
  return outcome;
}

function signal() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function bounded(promise, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(failure(message)), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function createPreferenceProbe(page, { origin, onObserved } = {}) {
  const target = new URL("/settings/appearance", origin ?? page.url());
  if (
    target.protocol !== "https:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    new URL(page.url()).origin !== target.origin ||
    new URL(page.url()).pathname !== target.pathname
  ) {
    throw failure("an authenticated owned loopback HTTPS appearance page is required");
  }
  const actions = [];
  const holds = new Set();
  const handlers = new Set();
  let pending;
  let error;
  let closing = false;
  let closed = false;
  const fail = (problem) => {
    // Network/Playwright exceptions can include request details. Preserve only declared labels.
    error ??=
      problem instanceof Error && problem.message.startsWith("Appearance action probe:")
        ? problem
        : failure("request, observation or response cleanup failed");
  };
  const assertHealthy = () => {
    if (error) throw error;
  };
  const record = async (hold, input, outcome) => {
    hold.observation = { sequence: actions.length + 1, ...input, outcome };
    actions.push(hold.observation);
    if (onObserved) await bounded(onObserved(hold.observation), "observation callback timed out");
    hold.reached.resolve();
  };
  const handle = async (route) => {
    const request = route.request();
    if (!isPreferenceRequest(request, target)) {
      await route.fallback();
      return;
    }
    const hold = pending;
    pending = undefined;
    let upstream;
    let timer;
    try {
      assertHealthy();
      const input = expectedInput(request, hold, closing);
      const releaseOnTimeout = () => {
        fail(failure("held response exceeded its ten second cap"));
        hold.gate.resolve();
      };
      if (hold.transportAbort) {
        timer = setTimeout(releaseOnTimeout, 10_000);
        await record(hold, input, { transport: "aborted_before_upstream" });
        await hold.gate.promise;
        assertHealthy();
        await route.abort("failed");
        return;
      }
      upstream = await route.fetch({ timeout: 10_000, maxRedirects: 0 });
      const outcome = await genuineOutcome(upstream, hold);
      timer = setTimeout(releaseOnTimeout, 10_000);
      await record(hold, input, outcome);
      await hold.gate.promise;
      assertHealthy();
      await route.fulfill({ response: upstream });
    } catch (problem) {
      fail(problem);
      try {
        await route.abort("failed");
      } catch {
        // The browser may already have terminated this exact owned route.
      }
    } finally {
      clearTimeout(timer);
      if (upstream) {
        try {
          await upstream.dispose();
        } catch (problem) {
          fail(problem);
        }
      }
      if (hold) {
        hold.reached.resolve();
        hold.delivered.resolve();
        holds.delete(hold);
      }
    }
  };
  const handler = (route) => {
    const running = handle(route).catch(fail);
    handlers.add(running);
    void running.finally(() => handlers.delete(running));
    return running;
  };
  await page.route("**/*", handler);
  return {
    actions,
    assertHealthy,
    expect({ kind, value, ok, transportAbort = false }) {
      assertHealthy();
      const values =
        kind === "appearance" ? ["day", "night", "system"] : ["comfortable", "compact"];
      if (
        closing ||
        pending ||
        !["appearance", "density"].includes(kind) ||
        !values.includes(value) ||
        typeof ok !== "boolean" ||
        typeof transportAbort !== "boolean"
      ) {
        throw failure("invalid or overlapping action expectation");
      }
      const hold = {
        kind,
        value,
        ok,
        transportAbort,
        reached: signal(),
        delivered: signal(),
        gate: signal(),
        observation: undefined,
      };
      pending = hold;
      holds.add(hold);
      const wait = async (event, label) => {
        try {
          await bounded(event.promise, label);
        } catch (problem) {
          fail(problem);
        }
        assertHealthy();
        return hold.observation;
      };
      return {
        reached: () => wait(hold.reached, "expected action was not observed"),
        release: () => hold.gate.resolve(),
        delivered: () => wait(hold.delivered, "expected response did not finish"),
      };
    },
    async close() {
      if (closed) {
        assertHealthy();
        return;
      }
      closing = true;
      for (const hold of holds) hold.gate.resolve();
      try {
        await page.unroute("**/*", handler);
        await bounded(Promise.all([...handlers]), "owned action routes did not drain");
      } catch (problem) {
        fail(problem);
      }
      if (pending) fail(failure("an expected action was never observed"));
      pending = undefined;
      closed = true;
      assertHealthy();
    },
  };
}
