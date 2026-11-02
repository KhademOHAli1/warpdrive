import { expect, test } from "vitest";
import { queueInputSchema } from "./queueInput";

test("queue input defaults to a bounded personal page", () => {
  expect(queueInputSchema.parse({})).toEqual({ scope: "mine", limit: 25, offset: 0 });
  expect(queueInputSchema.parse({ scope: "all-permitted", limit: 100, offset: 1000000 })).toEqual({
    scope: "all-permitted",
    limit: 100,
    offset: 1000000,
  });
});

test.each([
  { scope: "everyone" },
  { limit: 0 },
  { limit: 101 },
  { limit: 1.5 },
  { limit: "25" },
  { offset: -1 },
  { offset: 0.5 },
  { offset: 1000001 },
  { actor: { type: "admin" } },
  { asOf: "2000-01-01T00:00:00Z" },
  { timeZone: "Pacific/Honolulu" },
  { ownerId: "11111111-1111-4111-8111-111111111111" },
])("queue input rejects invalid or server-owned fields: %j", (raw) => {
  expect(queueInputSchema.safeParse(raw).success).toBe(false);
});
