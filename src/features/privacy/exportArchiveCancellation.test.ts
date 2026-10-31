import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { expect, test } from "vitest";
import { err, ok } from "@/types/result";
import { type PrivacyArchiveSource, writePrivacyExportArchive } from "./exportArchive";
import { archiveFixture, collectSink, deferred, entrySources, hash } from "./exportArchiveTestKit";

function singleSource(source: PrivacyArchiveSource): AsyncIterable<PrivacyArchiveSource> {
  return {
    [Symbol.asyncIterator]: () => {
      let sent = false;
      return {
        next: () => {
          if (sent) return Promise.resolve({ done: true as const, value: undefined });
          sent = true;
          return Promise.resolve({ done: false as const, value: source });
        },
      };
    },
  };
}

test("P09B: unavailable and failing source streams return static errors without sensitive driver values", async () => {
  for (const unavailable of [true, false]) {
    const fixture = archiveFixture();
    const first = fixture.entries[0];
    assert(first !== undefined);
    const source: PrivacyArchiveSource = {
      path: first.path,
      open: () => {
        if (unavailable) return Promise.resolve(err("source_unavailable"));
        const stream = new Readable({
          read() {
            this.destroy(new Error("PRIVATE-SOURCE-SENTINEL"));
          },
        });
        return Promise.resolve(ok(stream));
      },
    };
    const result = await writePrivacyExportArchive(
      fixture.manifest,
      singleSource(source),
      collectSink().stream,
      AbortSignal.timeout(5000),
    );
    expect(result).toEqual({
      ok: false,
      error: unavailable ? "source_unavailable" : "source_read_failed",
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
  }
});

test("P09B: sink failure terminates the current source and returns no artifact receipt", async () => {
  const fixture = archiveFixture();
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("PRIVATE-SINK-SENTINEL"));
    },
  });
  const result = await writePrivacyExportArchive(
    fixture.manifest,
    entrySources(fixture.entries),
    sink,
    AbortSignal.timeout(5000),
  );
  expect(result).toEqual({ ok: false, error: "archive_write_failed" });
  expect(JSON.stringify(result)).not.toContain("PRIVATE-");
});

test("C06: cancellation destroys an active source and sink and propagates outer AbortError", async () => {
  const fixture = archiveFixture();
  const first = fixture.entries[0];
  assert(first !== undefined);
  const active = new Readable({ read() {} });
  const opened = deferred<void>();
  const controller = new AbortController();
  const sink = collectSink();
  const result = writePrivacyExportArchive(
    fixture.manifest,
    singleSource({
      path: first.path,
      open: () => {
        opened.resolve();
        return Promise.resolve(ok(active));
      },
    }),
    sink.stream,
    controller.signal,
  );
  await opened.promise;
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(active.destroyed).toBe(true);
  expect(sink.stream.destroyed).toBe(true);
});

test("C06: cancellation does not wait for an uncooperative source opener and closes its late stream", async () => {
  const fixture = archiveFixture();
  const first = fixture.entries[0];
  assert(first !== undefined);
  const opening = deferred<ReturnType<typeof ok<Readable>>>();
  const started = deferred<void>();
  const controller = new AbortController();
  const result = writePrivacyExportArchive(
    fixture.manifest,
    singleSource({
      path: first.path,
      open: () => {
        started.resolve();
        return opening.promise;
      },
    }),
    collectSink().stream,
    controller.signal,
  );
  await started.promise;
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  const late = Readable.from([first.body]);
  opening.resolve(ok(late));
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(late.destroyed).toBe(true);
});

test("C06: cancellation after an opener resolves still closes its unused stream", async () => {
  const fixture = archiveFixture();
  const first = fixture.entries[0];
  assert(first !== undefined);
  const controller = new AbortController();
  const stream = new Readable({ read() {} });
  const source: PrivacyArchiveSource = {
    path: first.path,
    open: () => {
      const pending = Promise.resolve(ok(stream));
      void pending.then(() => queueMicrotask(() => controller.abort()));
      return pending;
    },
  };
  const result = writePrivacyExportArchive(
    fixture.manifest,
    singleSource(source),
    collectSink().stream,
    controller.signal,
  );
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(stream.destroyed).toBe(true);
});

test("C06: a blocked metadata iterator cannot pin cancellation and is asked to close", async () => {
  const fixture = archiveFixture();
  const started = deferred<void>();
  let closed = false;
  const entries: AsyncIterable<PrivacyArchiveSource> = {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        started.resolve();
        return new Promise<IteratorResult<PrivacyArchiveSource>>(() => undefined);
      },
      return: () => {
        closed = true;
        return Promise.resolve({ done: true as const, value: undefined });
      },
    }),
  };
  const controller = new AbortController();
  const result = writePrivacyExportArchive(
    fixture.manifest,
    entries,
    collectSink().stream,
    controller.signal,
  );
  await started.promise;
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(closed).toBe(true);
});

test("C08: a blocked private sink applies backpressure instead of buffering the complete attachment", async () => {
  const fixture = archiveFixture();
  const first = fixture.entries[0];
  const category = fixture.manifest.categories[0];
  assert(first !== undefined && category?.disposition === "include");
  const body = randomBytes(2 * 1024 * 1024);
  const file = category.files[0];
  assert(file !== undefined);
  category.files = [{ ...file, bytes: body.length, sha256: hash(body) }];
  const started = deferred<void>();
  const released = deferred<void>();
  let blocked = true;
  let produced = 0;
  const sink = new Writable({
    highWaterMark: 1024,
    write(_chunk, _encoding, callback) {
      if (!blocked) {
        callback();
        return;
      }
      blocked = false;
      started.resolve();
      void released.promise.then(() => callback());
    },
  });
  const source: PrivacyArchiveSource = {
    path: first.path,
    open: () =>
      Promise.resolve(
        ok(
          new Readable({
            highWaterMark: 16 * 1024,
            read() {
              if (produced === body.length) {
                this.push(null);
                return;
              }
              const end = Math.min(produced + 16 * 1024, body.length);
              this.push(body.subarray(produced, end));
              produced = end;
            },
          }),
        ),
      ),
  };
  const result = writePrivacyExportArchive(
    fixture.manifest,
    singleSource(source),
    sink,
    AbortSignal.timeout(5000),
  );
  await started.promise;
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  expect(produced).toBeLessThan(body.length);
  released.resolve();
  expect((await result).ok).toBe(true);
});

test("C10: malformed object-mode source chunks fail as values without an uncaught stream exception", async () => {
  const fixture = archiveFixture();
  const first = fixture.entries[0];
  assert(first !== undefined);
  const source: PrivacyArchiveSource = {
    path: first.path,
    open: () => Promise.resolve(ok(Readable.from([{ private: "PRIVATE-CHUNK-SENTINEL" }]))),
  };
  expect(
    await writePrivacyExportArchive(
      fixture.manifest,
      singleSource(source),
      collectSink().stream,
      AbortSignal.timeout(1000),
    ),
  ).toEqual({ ok: false, error: "source_read_failed" });
});
