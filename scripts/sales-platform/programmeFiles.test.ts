import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import type { open as openFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const openHook = vi.hoisted(() => ({
  before: undefined as (() => void) | undefined,
  after: undefined as (() => void) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<{ open: typeof openFile }>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      openHook.before?.();
      const handle = await actual.open(...args);
      openHook.after?.();
      return handle;
    },
  };
});

import { inspectFile, readProgrammeFile } from "./programmeFiles";

const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "wd-programme-files-"));
  roots.push(root);
  const directory = join(root, "docs");
  mkdirSync(directory);
  const file = join(directory, "register.json");
  writeFileSync(file, "original");
  return { root, directory, file, path: "docs/register.json" };
}

afterEach(() => {
  openHook.before = undefined;
  openHook.after = undefined;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("programme file reads", () => {
  it("reads a regular file through the 4 MiB boundary", async () => {
    const f = fixture();
    writeFileSync(f.file, Buffer.alloc(4 * 1024 * 1024, 0x61));
    const result = await readProgrammeFile(f.root, f.path, AbortSignal.timeout(5000));
    expect(result.ok && result.value.length).toBe(4 * 1024 * 1024);
    writeFileSync(f.file, Buffer.alloc(4 * 1024 * 1024 + 1, 0x61));
    const oversized = await readProgrammeFile(f.root, f.path, AbortSignal.timeout(5000));
    expect(oversized.ok ? undefined : oversized.error.code).toBe("file-size");
  });

  it("rejects a regular leaf replaced between inspection and opening", async () => {
    const f = fixture();
    openHook.before = () => {
      renameSync(f.file, join(f.directory, "original.json"));
      writeFileSync(f.file, "replacement");
    };
    const result = await readProgrammeFile(f.root, f.path, AbortSignal.timeout(5000));
    expect(result.ok ? undefined : result.error.code).toBe("unsafe-path");
  });

  it("rejects a leaf swapped for a symlink before opening", async () => {
    const f = fixture();
    const outside = mkdtempSync(join(tmpdir(), "wd-programme-outside-"));
    roots.push(outside);
    const secret = join(outside, "secret.txt");
    writeFileSync(secret, "secret content");
    openHook.before = () => {
      rmSync(f.file);
      symlinkSync(secret, f.file);
    };
    const result = await readProgrammeFile(f.root, f.path, AbortSignal.timeout(5000));
    expect(result.ok ? undefined : result.error.code).toBe("unsafe-path");
  });

  it("rejects an ancestor swapped for a directory outside the root", async () => {
    const f = fixture();
    const outside = mkdtempSync(join(tmpdir(), "wd-programme-outside-"));
    roots.push(outside);
    writeFileSync(join(outside, "register.json"), "outside content");
    openHook.before = () => {
      renameSync(f.directory, join(f.root, "old-docs"));
      symlinkSync(outside, f.directory);
    };
    const result = await readProgrammeFile(f.root, f.path, AbortSignal.timeout(5000));
    expect(result.ok ? undefined : result.error.code).toBe("unsafe-path");
  });

  it("rejects a path changed after the handle is opened", async () => {
    const f = fixture();
    openHook.after = () => {
      renameSync(f.file, join(f.directory, "original.json"));
      writeFileSync(f.file, "replacement");
    };
    const result = await readProgrammeFile(f.root, f.path, AbortSignal.timeout(5000));
    expect(result.ok ? undefined : result.error.code).toBe("unsafe-path");
  });

  it("rejects a same-size in-place rewrite after opening", async () => {
    const f = fixture();
    openHook.after = () => {
      writeFileSync(f.file, "changed!");
      const changedAt = new Date("2040-01-01T00:00:00Z");
      utimesSync(f.file, changedAt, changedAt);
    };
    const result = await readProgrammeFile(f.root, f.path, AbortSignal.timeout(5000));
    expect(result.ok ? undefined : result.error.code).toBe("unsafe-path");
  });

  it("keeps evidence inspection as an existence-only check and propagates aborts", async () => {
    const f = fixture();
    expect(inspectFile(f.root, f.path, AbortSignal.timeout(5000)).ok).toBe(true);
    const controller = new AbortController();
    controller.abort();
    await expect(readProgrammeFile(f.root, f.path, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
