import { describe, expect, it } from "vitest";
import { parseEnv } from "@/config/env";
import { testEnvInput } from "@/test/envInput";

function validWithoutAgencyFlag() {
  const input = testEnvInput();
  Reflect.deleteProperty(input, "AGENCY_PROJECTS_ENABLED");
  return input;
}

describe("Agency Projects operator startup boolean", () => {
  it("defaults omitted configuration to disabled", () => {
    const result = parseEnv(validWithoutAgencyFlag());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.AGENCY_PROJECTS_ENABLED).toBe(false);
  });

  it.each([
    ["true", true],
    ["false", false],
  ] as const)("parses exact %s as the boolean %s", (input, expected) => {
    const result = parseEnv({
      ...validWithoutAgencyFlag(),
      AGENCY_PROJECTS_ENABLED: input,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.AGENCY_PROJECTS_ENABLED).toBe(expected);
  });

  it.each([
    "",
    " ",
    "TRUE",
    "FALSE",
    "1",
    "0",
    "yes",
    "on",
    "enabled",
    "false ",
    " true",
    "false\n",
  ])("rejects noncanonical operator configuration: %j", (value) => {
    const result = parseEnv({
      ...validWithoutAgencyFlag(),
      AGENCY_PROJECTS_ENABLED: value,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("AGENCY_PROJECTS_ENABLED");
  });
});
