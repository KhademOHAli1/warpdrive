import { createHash } from "node:crypto";
import { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { Socket } from "node:net";
import { addAbortSignal, type Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { getCloneableBody } from "next/dist/server/body-streams";
import { defaultConfig } from "next/dist/server/config-shared";
import { afterEach, expect, test, vi } from "vitest";
import { MAX_IMPORT_CSV_BYTES } from "@/features/import/importFields";
import nextConfig from "../next.config";

// Use the installed parser and defaults without loading a Next server or environment files.
const bytes = createRequire(import.meta.url)("next/dist/compiled/bytes") as {
  parse(value: string): number | null;
};
const MIB = 1024 * 1024;
const EXISTING_ACTION_CONTRACT_BYTES = 64 * MIB;
const PREFIX = Buffer.from('{"rows":[["');
const TAIL = Buffer.from('"]],"privateTail":"PRIVATE-synthetic-tail"}');
const FILL = Buffer.alloc(64 * 1024, "a");

function toBytes(limit: string | number): number {
  return typeof limit === "number" ? limit : (bytes.parse(limit) ?? 0);
}

function* jsonChunks(bodyBytes: number): Generator<Buffer, void> {
  yield PREFIX;
  let remaining = bodyBytes - PREFIX.length - TAIL.length;
  while (remaining > 0) {
    const chunkBytes = Math.min(remaining, FILL.length);
    yield FILL.subarray(0, chunkBytes);
    remaining -= chunkBytes;
  }
  yield TAIL;
}

interface Fingerprint {
  bytes: number;
  sha256: string;
  tail: string;
}

async function fingerprint(stream: Readable, signal: AbortSignal): Promise<Fingerprint> {
  signal.throwIfAborted();
  const hash = createHash("sha256");
  let count = 0;
  let tail = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    count += chunk.length;
    hash.update(chunk);
    tail = Buffer.from(
      chunk.length >= TAIL.length
        ? chunk.subarray(-TAIL.length)
        : Buffer.concat([tail, chunk]).subarray(-TAIL.length),
    );
  };
  stream.on("data", onData);
  try {
    await finished(stream, { cleanup: true, readable: true, writable: false, signal });
    signal.throwIfAborted();
    return { bytes: count, sha256: hash.digest("hex"), tail: tail.toString("utf8") };
  } finally {
    stream.off("data", onData);
  }
}

async function cloneBothBodies(bodyBytes: number, signal: AbortSignal) {
  signal.throwIfAborted();
  // An unconnected socket supplies IncomingMessage's transport shape. No network is opened.
  // Reusing an immutable 64KiB chunk keeps fixture allocation independent of the payload size.
  const socket = new Socket();
  const request = addAbortSignal(signal, new IncomingMessage(socket));
  request.method = "POST";
  request.url = "/settings/import";
  const sourceHash = createHash("sha256");
  const chunks = jsonChunks(bodyBytes);
  request._read = () => {
    const chunk = chunks.next();
    if (chunk.done === true) {
      request.complete = true;
      request.push(null);
      return;
    }
    sourceHash.update(chunk.value);
    request.push(chunk.value);
  };

  const configuredLimit =
    nextConfig.experimental?.proxyClientMaxBodySize ??
    defaultConfig.experimental.proxyClientMaxBodySize;
  const body = getCloneableBody(request, toBytes(configuredLimit));
  const proxyStream = body.cloneBodyStream();
  try {
    const proxyBody = await fingerprint(proxyStream, signal);
    signal.throwIfAborted();
    // Next's Node proxy finalizes the original IncomingMessage before route/action handling.
    await body.finalize();
    signal.throwIfAborted();
    const downstreamBody = await fingerprint(request, signal);
    signal.throwIfAborted();
    return {
      proxyBody,
      downstreamBody,
      expected: {
        bytes: bodyBytes,
        sha256: sourceHash.digest("hex"),
        tail: TAIL.toString("utf8"),
      },
    };
  } finally {
    proxyStream.destroy();
    request.destroy();
    socket.destroy();
  }
}

afterEach(() => vi.restoreAllMocks());

const BODY_CASES = [
  { label: "a POST above Next's default clone limit", bodyBytes: 11 * MIB },
  // Synthetic compatibility envelope, not a claim that today's storage-backed import sends rows.
  {
    label: "a CSV-cap-derived 2.2x JSON envelope",
    bodyBytes: Math.ceil(MAX_IMPORT_CSV_BYTES * 2.2),
  },
  {
    label: "the full existing 64MiB Server Action contract",
    bodyBytes: EXISTING_ACTION_CONTRACT_BYTES,
  },
];

test.for(BODY_CASES)(
  "preserves $label for proxy and downstream consumers",
  { timeout: 10_000 },
  async ({ bodyBytes }, { signal }) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const actionLimit = nextConfig.experimental?.serverActions?.bodySizeLimit ?? 0;
    expect(toBytes(actionLimit)).toBeGreaterThanOrEqual(bodyBytes);
    const { proxyBody, downstreamBody, expected } = await cloneBothBodies(bodyBytes, signal);
    signal.throwIfAborted();
    // Compact fingerprints expose byte loss without retaining or printing the synthetic body.
    expect.soft(proxyBody).toEqual(expected);
    expect.soft(downstreamBody).toEqual(expected);
    expect.soft(warning).not.toHaveBeenCalled();
  },
);
