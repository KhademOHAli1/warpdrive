import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

test.each(["late", "resolved"] as const)(
  "C06: %s unused stream destruction errors stay observed only until close",
  async (timing) => {
    const codec = fileURLToPath(new URL("./exportArchive.ts", import.meta.url));
    const fixtures = fileURLToPath(new URL("./exportArchiveTestKit.ts", import.meta.url));
    // An isolated process makes a real unhandled stream error observable without
    // installing a global exception handler in the test runner.
    const script = `
      import assert from "node:assert/strict";
      import { Readable } from "node:stream";
      import { writePrivacyExportArchive } from ${JSON.stringify(codec)};
      import { archiveFixture, collectSink, deferred } from ${JSON.stringify(fixtures)};
      const fixture = archiveFixture();
      const controller = new AbortController();
      const opening = deferred();
      const started = deferred();
      const destroyed = deferred();
      const stream = new Readable({
        read() {},
        destroy(_error, callback) {
          destroyed.resolve();
          setImmediate(() => callback(new Error("PRIVATE-LATE-CLOSE-SENTINEL")));
        },
      });
      const source = {
        path: fixture.entries[0].path,
        open() {
          started.resolve();
          if (${JSON.stringify(timing)} === "late") return opening.promise;
          const pending = Promise.resolve({ ok: true, value: stream });
          void pending.then(() => queueMicrotask(() => controller.abort()));
          return pending;
        },
      };
      const entries = { [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: false, value: source }),
      }) };
      const result = writePrivacyExportArchive(
        fixture.manifest, entries, collectSink().stream, controller.signal,
      );
      if (${JSON.stringify(timing)} === "late") {
        await started.promise;
        controller.abort();
      }
      await assert.rejects(result, { name: "AbortError" });
      opening.resolve({ ok: true, value: stream });
      await destroyed.promise;
      assert.equal(stream.destroyed, true);
      const errorObservers = stream.listenerCount("error");
      await new Promise((resolve) => stream.once("close", resolve));
      assert.ok(errorObservers > 0);
      assert.equal(stream.listenerCount("error"), 0);
      assert.equal(stream.listenerCount("close"), 0);
    `;
    const result = await promisify(execFile)(process.execPath, ["--eval", script], {
      signal: AbortSignal.timeout(5000),
    }).then(
      (value) => ({ ...value, status: "finished" }),
      (cause: unknown) => ({
        status: "failed",
        stdout: "",
        stderr:
          cause instanceof Error && "stderr" in cause && typeof cause.stderr === "string"
            ? cause.stderr
            : "subprocess_failed",
      }),
    );
    expect({
      status: result.status,
      privateErrorEscaped: result.stderr.includes("PRIVATE-LATE-CLOSE-SENTINEL"),
    }).toEqual({ status: "finished", privateErrorEscaped: false });
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  },
);
