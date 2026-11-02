import { expect, test } from "vitest";
import { privacyCapabilitiesSchema } from "./capabilities";

test("capability input rejects unknown, duplicate and overbroad authority", () => {
  expect(privacyCapabilitiesSchema.safeParse(["case.review", "case.erase.execute"]).success).toBe(
    true,
  );
  for (const input of [["admin"], ["*"], ["case.review", "case.review"], ["data.export"]])
    expect(privacyCapabilitiesSchema.safeParse(input).success).toBe(false);
});
