import { z } from "zod";
import {
  coreOrigin,
  coreProxyToken,
  frontendTrustedProxyHeader,
  parseHttpOrigin,
  webPublicOrigin,
} from "./config";

const PROBE_DEADLINE_MS = 3_000;
const MAX_PROBE_BYTES = 8_192;

type ReadinessCode =
  | "WEB_READY"
  | "WEB_READINESS_CONFIGURATION_INVALID"
  | "WEB_READINESS_CORE_UNAUTHORIZED"
  | "WEB_READINESS_CORE_TIMEOUT"
  | "WEB_READINESS_CORE_UNAVAILABLE"
  | "WEB_READINESS_CORE_INCOMPATIBLE"
  | "WEB_READINESS_ORIGIN_MISMATCH";

// Prove the exact transport envelope and the established bootstrap fields. Other
// Core configuration fields can evolve independently without breaking readiness.
const configurationReply = z.strictObject({
  result: z.strictObject({
    data: z.strictObject({
      json: z.object({ BASE_URL: z.string(), MCP_ENABLED: z.boolean() }),
    }),
  }),
});

async function readProbeJson(body: ReadableStream<Uint8Array>): Promise<unknown> {
  const reader = body.getReader();
  const bytes = new Uint8Array(MAX_PROBE_BYTES);
  let length = 0;
  let ended = false;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) {
        ended = true;
        break;
      }
      if (part.value.byteLength > MAX_PROBE_BYTES - length) return null;
      bytes.set(part.value, length);
      length += part.value.byteLength;
    }
  } finally {
    if (!ended) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
  } catch {
    return null;
  }
}

async function probeCore(
  origin: string,
  token: string,
  publicOrigin: string | null,
  signal: AbortSignal,
): Promise<ReadinessCode> {
  const response = await fetch(`${origin}/api/trpc/frontend.configuration`, {
    headers: { accept: "application/json", "x-warpdrive-proxy-token": token },
    cache: "no-store",
    redirect: "manual",
    signal,
  });
  const body = response.body;
  if (signal.aborted) {
    void body?.cancel().catch(() => undefined);
    return "WEB_READINESS_CORE_TIMEOUT";
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (response.status !== 200 || body === null || contentType !== "application/json") {
    void body?.cancel().catch(() => undefined);
    if (response.status === 401 || response.status === 403)
      return "WEB_READINESS_CORE_UNAUTHORIZED";
    if (response.status === 429 || response.status >= 500) return "WEB_READINESS_CORE_UNAVAILABLE";
    return "WEB_READINESS_CORE_INCOMPATIBLE";
  }
  const parsed = configurationReply.safeParse(await readProbeJson(body));
  if (!parsed.success) return "WEB_READINESS_CORE_INCOMPATIBLE";
  const reportedOrigin = parseHttpOrigin(parsed.data.result.data.json.BASE_URL);
  if (reportedOrigin === null) return "WEB_READINESS_CORE_INCOMPATIBLE";
  if (publicOrigin !== null && publicOrigin !== reportedOrigin)
    return "WEB_READINESS_ORIGIN_MISMATCH";
  return "WEB_READY";
}

export async function webReadiness(): Promise<ReadinessCode> {
  let origin: string;
  let token: string;
  let publicOrigin: string | null;
  try {
    origin = coreOrigin();
    token = coreProxyToken();
    publicOrigin = webPublicOrigin();
    frontendTrustedProxyHeader();
    if (origin === publicOrigin) return "WEB_READINESS_CONFIGURATION_INVALID";
  } catch {
    return "WEB_READINESS_CONFIGURATION_INVALID";
  }

  const controller = new AbortController();
  const signal = controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ReadinessCode>((resolve) => {
    timer = setTimeout(() => {
      resolve("WEB_READINESS_CORE_TIMEOUT");
      controller.abort();
    }, PROBE_DEADLINE_MS);
  });
  try {
    return await Promise.race([probeCore(origin, token, publicOrigin, signal), timeout]);
  } catch {
    return signal.aborted ? "WEB_READINESS_CORE_TIMEOUT" : "WEB_READINESS_CORE_UNAVAILABLE";
  } finally {
    clearTimeout(timer);
  }
}
