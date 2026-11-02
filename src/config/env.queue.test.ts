import { expect, test } from "vitest";
import { testEnvInput } from "@/test/envInput";
import { parseEnv } from "./env";

test("the next-action queue is off unless explicitly enabled", () => {
  const result = parseEnv({ ...testEnvInput(), SALES_NEXT_ACTION_QUEUE_ENABLED: undefined });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.SALES_NEXT_ACTION_QUEUE_ENABLED).toBe(false);
});

test("an explicit queue opt-in is parsed at the single environment boundary", () => {
  const result = parseEnv({ ...testEnvInput(), SALES_NEXT_ACTION_QUEUE_ENABLED: "true" });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.SALES_NEXT_ACTION_QUEUE_ENABLED).toBe(true);
});

test("a misspelled queue flag is rejected instead of silently enabling a route", () => {
  expect(parseEnv({ ...testEnvInput(), SALES_NEXT_ACTION_QUEUE_ENABLED: "enabled" }).ok).toBe(
    false,
  );
});
