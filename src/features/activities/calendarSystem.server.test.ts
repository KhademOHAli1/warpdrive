import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("imports Iranian calendar math in React Server Component conditions", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "-e",
      "import {startOfCalendarMonth} from './src/features/activities/calendarSystem'; console.log(startOfCalendarMonth(new Date('2026-03-21T00:00:00Z'),{calendar:'persian'}).toISOString());",
    ],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("2026-03-21T00:00:00.000Z");
});
