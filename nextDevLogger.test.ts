import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const magicIdentifier = require("next/dist/shared/lib/magic-identifier");

class ModuleBuildError extends Error {}
class TurbopackInternalError extends Error {}

// Exercise the installed package's real helper without starting its filesystem watcher.
// Both distributions ship with Next; an upgrade that moves it requires reviewing the patch.
function installedLogger(distribution: "commonjs" | "esm") {
  const prefix = distribution === "esm" ? "esm/" : "";
  const source = readFileSync(
    new URL(
      `./node_modules/next/dist/${prefix}server/lib/router-utils/setup-dev-bundler.js`,
      import.meta.url,
    ),
    "utf8",
  );
  const helper = source.match(
    /function logErrorWithOriginalStack\(err, type\) \{[\s\S]*?\n {4}\}/,
  )?.[0];
  if (helper === undefined) throw new Error("Next's development logger moved; review its patch");
  const error = vi.fn<(value: unknown, error?: unknown) => void>();
  const warn = vi.fn<(value: unknown) => void>();
  const log = { error, warn };
  const report = runInNewContext(`"use strict"; (${helper})`, {
    Error,
    Reflect,
    Object,
    ModuleBuildError,
    TurbopackInternalError,
    _utils2: { ModuleBuildError },
    _internalerror: { TurbopackInternalError },
    _magicidentifier: magicIdentifier,
    deobfuscateText: magicIdentifier.deobfuscateText,
    _log: log,
    Log: log,
  }) as (value: unknown, type?: string) => void;
  return { report, error, warn };
}

describe.each(["commonjs", "esm"] as const)("Next %s development error logger", (distribution) => {
  it("reports a readonly timeout without replacing its name, cause, stack or digest", () => {
    const logger = installedLogger(distribution);
    const cause = new Error("original I/O failure");
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    Object.defineProperties(timeout, {
      cause: { value: cause },
      digest: { value: "original-request-digest" },
    });
    const stack = timeout.stack;

    expect(() => logger.report(timeout, "app-dir")).not.toThrow();
    expect(logger.error).toHaveBeenCalledOnce();
    const reported: unknown = logger.error.mock.calls[0]?.[0];
    expect(reported).toBeInstanceOf(Error);
    if (!(reported instanceof Error)) throw new Error("The original timeout was not reported");
    expect(reported.name).toBe("TimeoutError");
    expect(reported.message).toBe("The operation timed out.");
    expect(reported.cause).toBe(cause);
    expect(reported.stack).toBe(stack);
    expect(reported).toHaveProperty("digest", "original-request-digest");
    expect(timeout.message).toBe("The operation timed out.");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("still deobfuscates readonly messages and reports the underlying failure", () => {
    const logger = installedLogger(distribution);
    const timeout = new DOMException("Timed out in __TURBOPACK__module__", "TimeoutError");

    expect(() => logger.report(timeout, "app-dir")).not.toThrow();
    expect(logger.error.mock.calls[0]?.[0]).toMatchObject({
      name: "TimeoutError",
      message: "Timed out in {module}",
    });
    expect(timeout.message).toBe("Timed out in __TURBOPACK__module__");
  });

  it("preserves normal Error identity, metadata and warning routing", () => {
    const logger = installedLogger(distribution);
    const cause = new Error("original cause");
    const error = new Error("Failed in __TURBOPACK__module__", { cause });
    const stack = error.stack;
    Object.defineProperty(error, "digest", { value: "normal-error-digest" });

    logger.report(error, "warning");

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(error);
    expect(error.message).toBe("Failed in {module}");
    expect(error.cause).toBe(cause);
    expect(error.stack).toBe(stack);
    expect(error).toHaveProperty("digest", "normal-error-digest");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("retains build-error routing when a frozen error needs a writable copy", () => {
    const logger = installedLogger(distribution);
    const error = Object.freeze(new ModuleBuildError("Failed in __TURBOPACK__module__"));

    expect(() => logger.report(error, "app-dir")).not.toThrow();
    expect(logger.error).toHaveBeenCalledExactlyOnceWith("Failed in {module}");
    expect(error.message).toBe("Failed in __TURBOPACK__module__");
  });
});
