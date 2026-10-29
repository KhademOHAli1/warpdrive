import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("formats catalog messages in Bun's React server module environment", () => {
  const output = execFileSync(
    "bun",
    [
      "--conditions=react-server",
      "-e",
      'import {createAppTranslator} from "./src/features/i18n/catalog.ts"; console.log(createAppTranslator("fa", "shell")("searchOpen"));',
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  expect(output.trim()).toBe("باز کردن جست‌وجو");
});
