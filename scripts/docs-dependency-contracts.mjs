import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Resolve through each installed consumer, so a hoisted unrelated package cannot satisfy a check.
const docsRequire = createRequire(new URL("../docs-site/package.json", import.meta.url));
const coreRequire = createRequire(docsRequire.resolve("@docusaurus/core/package.json"));
const bundlerRequire = createRequire(coreRequire.resolve("@docusaurus/bundler"));

async function tinypoolContract() {
  assert.equal(coreRequire("tinypool/package.json").version, "2.1.2");
  const { default: Tinypool } = await import(pathToFileURL(coreRequire.resolve("tinypool")).href);
  const directory = await mkdtemp(join(tmpdir(), "warpdrive-docs-contract-"));
  const filename = join(directory, "worker.mjs");
  let pool;
  try {
    await writeFile(
      filename,
      `import { threadId, workerData } from "node:worker_threads";
const workerId = process.__tinypool_state__?.workerId;
const params = workerData?.[1]?.params;
if (!workerId || params?.marker !== "docs-contract") {
  throw new Error("Docusaurus worker ID/data contract changed");
}
export default function task({ value, barrier }) {
  const arrivals = new Int32Array(barrier);
  Atomics.add(arrivals, 0, 1);
  Atomics.notify(arrivals, 0);
  while (Atomics.load(arrivals, 0) < 2) {
    if (Atomics.wait(arrivals, 0, 1, 5000) === "timed-out") {
      throw new Error("Both SSG worker threads must execute");
    }
  }
  return { doubled: value * 2, threadId, workerId, marker: params.marker };
}
`,
    );
    // These are the options used by Docusaurus 3.10.2's pooled SSG executor.
    pool = new Tinypool({
      filename,
      minThreads: 2,
      maxThreads: 2,
      concurrentTasksPerWorker: 1,
      runtime: "worker_threads",
      isolateWorkers: false,
      workerData: { params: { marker: "docs-contract" } },
      maxMemoryLimitBeforeRecycle: 128 * 1024 * 1024,
      resourceLimits: {},
      terminateTimeout: 5000,
    });
    const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const results = await Promise.all(
      [3, 7].map((value) => pool.run({ value, barrier }, { signal: AbortSignal.timeout(15_000) })),
    );
    assert.deepEqual(
      results.map((result) => result.doubled),
      [6, 14],
    );
    assert.equal(new Set(results.map((result) => result.threadId)).size, 2);
    for (const result of results) {
      assert.ok(result.threadId > 0 && result.workerId > 0);
      assert.equal(result.marker, "docs-contract");
    }
  } finally {
    try {
      await pool?.destroy();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

function serializerContract() {
  for (const consumer of ["copy-webpack-plugin", "css-minimizer-webpack-plugin"]) {
    const consumerRequire = createRequire(bundlerRequire.resolve(consumer));
    assert.equal(consumerRequire("serialize-javascript/package.json").version, "7.1.3");
    const serialize = consumerRequire("serialize-javascript");
    assert.equal(typeof serialize, "function", `${consumer} needs a callable CJS serializer`);
    const options = {
      name: 'Mail "guide" <overview>',
      input: { "guide.css": "a::after{content:'<mail>'}" },
      lines: "first\u2028second\u2029third",
    };
    const encoded = serialize(options);
    assert.deepEqual(JSON.parse(encoded), options);
    assert.ok(!encoded.includes("<") && !encoded.includes(">"));
    assert.ok(!encoded.includes("\u2028") && !encoded.includes("\u2029"));
    // Copy's cache keys and CSS's worker options can also contain implementation functions.
    const withFunction = serialize({
      options,
      implementation: function identity(value) {
        return value;
      },
    });
    assert.match(withFunction, /function identity/);
    assert.ok(withFunction.includes("\\u003C"));
  }
}

function sockjsUuidContract() {
  const serverRequire = createRequire(coreRequire.resolve("webpack-dev-server"));
  const sockjsRequire = createRequire(serverRequire.resolve("sockjs"));
  assert.equal(sockjsRequire("uuid/package.json").version, "11.1.1");
  // sockjs 0.3.24 uses exactly require("uuid").v4() without arguments.
  const uuidv4 = sockjsRequire("uuid").v4;
  assert.equal(typeof uuidv4, "function");
  const ids = Array.from({ length: 4 }, () => uuidv4());
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  }
  assert.equal(new Set(ids).size, ids.length);
}

await tinypoolContract();
serializerContract();
sockjsUuidContract();
console.log(
  "Documentation dependency contracts passed: SSG workers, CJS serializers and SockJS UUIDs",
);
