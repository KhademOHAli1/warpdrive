import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("imports pure enrichment messages and audit labels in Bun's React server environment", () => {
  const output = execFileSync(
    "bun",
    [
      "--conditions=react-server",
      "-e",
      `
    import {enrichmentMessagesForLocale, PROVIDER_NAMES} from "./src/features/enrichment/enrichmentMessages.ts";
    import {providerName} from "./src/features/enrichment/providerNames.ts";
    import {formatChangeLabel} from "./src/features/deal-workspace/changeLabel.ts";
    console.log(JSON.stringify({
      en: enrichmentMessagesForLocale("en").button.label,
      fa: enrichmentMessagesForLocale("fa").dialog.apply(12),
      known: PROVIDER_NAMES.apollo,
      unknown: providerName("__proto__"),
      history: formatChangeLabel({field:"org.industry", oldValue:"Retail", newValue:{value:"Fintech", providers:["apollo","toString"]}}, "en")
    }));
  `,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  expect(JSON.parse(output)).toEqual({
    en: "Fill the gaps",
    fa: "ثبت ۱۲ فیلد",
    known: "Apollo",
    unknown: "__proto__",
    history: "Industry: Retail → Fintech (from Apollo and toString)",
  });
});
