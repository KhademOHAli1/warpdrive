import { expect, test } from "vitest";
import { applyDevelopmentCachePolicy } from "./developmentCache";

test("low-space development uses memory without changing other webpack configuration", () => {
  const config = { cache: { type: "filesystem" }, name: "client", plugins: ["retained"] };
  const result = applyDevelopmentCachePolicy(config, true, () => 1024);
  expect(result).toBe(config);
  expect(result).toEqual({ cache: { type: "memory" }, name: "client", plugins: ["retained"] });
});

test("normal development and production retain their existing cache behavior", () => {
  const enough = { cache: { type: "filesystem" } };
  expect(applyDevelopmentCachePolicy(enough, true, () => 20 * 1024 ** 3)).toEqual(enough);
  const production = { cache: { type: "filesystem" } };
  let inspected = false;
  expect(
    applyDevelopmentCachePolicy(production, false, () => {
      inspected = true;
      return 0;
    }),
  ).toBe(production);
  expect(inspected).toBe(false);
  expect(production.cache.type).toBe("filesystem");
});

test("unavailable storage metadata does not crash development startup", () => {
  expect(applyDevelopmentCachePolicy({}, true, () => undefined)).toEqual({
    cache: { type: "memory" },
  });
});
