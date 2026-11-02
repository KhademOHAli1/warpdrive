import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { checkRegistryCoverage, privacyRegistry } from "../src/features/privacy/registry";
import {
  collectInventorySources,
  discoverInventorySources,
} from "../src/features/privacy/registryDiscovery";

const root = fileURLToPath(new URL("..", import.meta.url));
const signal = AbortSignal.timeout(30_000);
const sources = await collectInventorySources(root, signal);
if (!sources.ok) {
  process.stderr.write(`${JSON.stringify(sources.error)}\n`);
  process.exitCode = 1;
} else {
  const discovered = discoverInventorySources(sources.value, signal);
  const coverage = checkRegistryCoverage(discovered, privacyRegistry);
  const counts: Record<string, number> = {};
  for (const item of discovered) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  const fingerprint = createHash("sha256");
  for (const source of sources.value)
    fingerprint.update(source.path).update("\0").update(source.source).update("\0");
  process.stdout.write(
    `${JSON.stringify(
      {
        registryVersion: privacyRegistry.version,
        evidenceLevel: "source_inventory",
        sourceFingerprint: fingerprint.digest("hex"),
        sourceFiles: sources.value.length,
        discoveredCounts: counts,
        classifiedDeclarations: privacyRegistry.entries.reduce(
          (total, entry) => total + entry.ids.length,
          0,
        ),
        coverage,
        installationGates:
          "OPEN: physical storage, provider contracts/receipts, production logs and backup destinations require separate acceptance.",
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = coverage.ok ? 0 : 1;
}
