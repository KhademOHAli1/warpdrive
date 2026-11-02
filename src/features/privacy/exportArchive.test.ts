import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { ok } from "@/types/result";
import { writePrivacyExportArchive } from "./exportArchive";
import {
  archiveFixture,
  collectSink,
  entrySources,
  hash,
  readArchive,
} from "./exportArchiveTestKit";

const signal = () => AbortSignal.timeout(5000);

test("P09A: streamed TAR.GZ roundtrip contains the exact UTF-8 manifest and approved Unicode files", async () => {
  const fixture = archiveFixture();
  const sink = collectSink();
  const result = await writePrivacyExportArchive(
    fixture.manifest,
    entrySources(fixture.entries),
    sink.stream,
    signal(),
  );
  expect(result.ok).toBe(true);
  assert(result.ok);
  const bytes = sink.bytes();
  expect(result.value).toEqual({
    format: "tar.gz",
    sha256: hash(bytes),
    bytes: bytes.length,
    files: fixture.entries.length,
  });
  const contents = await readArchive(bytes);
  expect([...contents.keys()].sort()).toEqual(
    ["manifest.json", ...fixture.entries.map((entry) => entry.path)].sort(),
  );
  expect(JSON.parse(contents.get("manifest.json")?.toString("utf8") ?? "null")).toEqual(
    fixture.manifest,
  );
  for (const entry of fixture.entries) expect(contents.get(entry.path)).toEqual(entry.body);
});

test("P09A: the system tar reader extracts Persian content from the generated archive", async () => {
  const fixture = archiveFixture();
  const sink = collectSink();
  const result = await writePrivacyExportArchive(
    fixture.manifest,
    entrySources(fixture.entries),
    sink.stream,
    signal(),
  );
  assert(result.ok);
  const directory = await mkdtemp(join(tmpdir(), "warpdrive-private-archive-"));
  try {
    const filename = join(directory, "synthetic.tar.gz");
    await writeFile(filename, sink.bytes(), { signal: signal() });
    const first = fixture.entries[0];
    assert(first !== undefined);
    const extracted = await promisify(execFile)("tar", ["-xOzf", filename, first.path], {
      encoding: "buffer",
      signal: signal(),
    });
    expect(extracted.stdout).toEqual(first.body);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(["size", "checksum"] as const)(
  "P09B: an actual streamed %s mismatch cannot return a valid artifact receipt",
  async (mismatch) => {
    const fixture = archiveFixture();
    const category = fixture.manifest.categories[0];
    assert(category?.disposition === "include");
    const file = category.files[0];
    assert(file !== undefined);
    if (mismatch === "size") file.bytes++;
    else file.sha256 = "0".repeat(64);
    const sink = collectSink();
    expect(
      await writePrivacyExportArchive(
        fixture.manifest,
        entrySources(fixture.entries),
        sink.stream,
        signal(),
      ),
    ).toEqual({
      ok: false,
      error: mismatch === "size" ? "entry_size_mismatch" : "entry_checksum_mismatch",
    });
    expect(sink.stream.destroyed).toBe(true);
  },
);

test.each(["missing", "duplicate", "unknown"] as const)(
  "P09B: %s source entries do not produce an accepted archive",
  async (kind) => {
    const fixture = archiveFixture();
    const first = fixture.entries[0];
    assert(first !== undefined);
    const entries =
      kind === "missing"
        ? []
        : kind === "duplicate"
          ? [first, first]
          : [{ ...first, path: first.path.replace("مخاطب.json", "unapproved.json") }];
    const sink = collectSink();
    expect(
      await writePrivacyExportArchive(
        fixture.manifest,
        entrySources(entries),
        sink.stream,
        signal(),
      ),
    ).toEqual({
      ok: false,
      error:
        kind === "missing"
          ? "entry_missing"
          : kind === "duplicate"
            ? "entry_duplicate"
            : "entry_unapproved",
    });
  },
);

test("P09B/C10: blocked manifests and unsafe entry paths fail before opening a source or writing bytes", async () => {
  for (const unsafe of [false, true]) {
    const fixture = archiveFixture();
    if (!unsafe) fixture.manifest.state = "blocked";
    else {
      const category = fixture.manifest.categories[0];
      assert(category?.disposition === "include");
      const file = category.files[0];
      assert(file !== undefined);
      file.path = "../private.json";
    }
    const sink = collectSink();
    expect(
      await writePrivacyExportArchive(
        fixture.manifest,
        entrySources(fixture.entries),
        sink.stream,
        signal(),
      ),
    ).toEqual({ ok: false, error: unsafe ? "invalid_archive_manifest" : "manifest_blocked" });
    expect(sink.bytes()).toHaveLength(0);
  }
});

test("P09A: an empty reviewed manifest produces only the fixed internal manifest file", async () => {
  const fixture = archiveFixture();
  fixture.manifest.categories = [];
  const sink = collectSink();
  const result = await writePrivacyExportArchive(
    fixture.manifest,
    entrySources([]),
    sink.stream,
    signal(),
  );
  expect(result.ok).toBe(true);
  const contents = await readArchive(sink.bytes());
  expect([...contents.keys()]).toEqual(["manifest.json"]);
});

test("C03: async source mutation cannot change snapshotted manifest expectations", async () => {
  const fixture = archiveFixture();
  const expected = structuredClone(fixture.manifest);
  const entries = entrySources(fixture.entries, () => {
    fixture.manifest.binding.scopeVersion++;
    fixture.manifest.categories = [];
  });
  const sink = collectSink();
  const result = await writePrivacyExportArchive(fixture.manifest, entries, sink.stream, signal());
  assert(result.ok);
  const contents = await readArchive(sink.bytes());
  expect(JSON.parse(contents.get("manifest.json")?.toString("utf8") ?? "null")).toEqual(expected);
});

test("C10: a source opener cannot substitute a traversal header after path approval", async () => {
  const fixture = archiveFixture();
  const first = fixture.entries[0];
  const category = fixture.manifest.categories[0];
  assert(first !== undefined && category?.disposition === "include");
  category.files = category.files.slice(0, 1);
  const source = {
    path: first.path,
    open: () => {
      source.path = "../../outside.txt";
      return Promise.resolve(ok(Readable.from([first.body])));
    },
  };
  const entries = {
    [Symbol.asyncIterator]: () => {
      let delivered = false;
      return {
        next: () => {
          if (delivered) return Promise.resolve({ done: true as const, value: undefined });
          delivered = true;
          return Promise.resolve({ done: false as const, value: source });
        },
      };
    },
  };
  const sink = collectSink();
  const result = await writePrivacyExportArchive(fixture.manifest, entries, sink.stream, signal());
  assert(result.ok);
  expect([...(await readArchive(sink.bytes())).keys()].sort()).toEqual(
    [first.path, "manifest.json"].sort(),
  );
});

test("C08: a source exceeding the reviewed byte count is stopped without a valid receipt", async () => {
  const fixture = archiveFixture();
  const first = fixture.entries[0];
  assert(first !== undefined);
  first.body = Buffer.concat([first.body, Buffer.from("EXTRA")]);
  expect(
    await writePrivacyExportArchive(
      fixture.manifest,
      entrySources(fixture.entries),
      collectSink().stream,
      signal(),
    ),
  ).toEqual({ ok: false, error: "entry_size_mismatch" });
});
