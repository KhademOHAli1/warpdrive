import { expect, it } from "vitest";
import { emergencyLocale } from "./emergencyLocale";

it("uses a supported persisted language when the application provider cannot render", () => {
  expect(emergencyLocale("other=1; warpdrive_locale=fa; x=2")).toBe("fa");
  expect(emergencyLocale("warpdrive_locale=invalid")).toBe("en");
  expect(emergencyLocale("warpdrive_locale=%ZZ")).toBe("en");
  expect(emergencyLocale("")).toBe("en");
});
