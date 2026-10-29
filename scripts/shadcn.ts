import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = "src/components/ui/primitives";
const registrySchema = z.object({
  style: z.literal("radix-nova"),
  components: z.array(z.string().regex(/^[a-z-]+$/)).min(1),
});
const lockSchema = z.object({ files: z.record(z.string(), z.string()) });
const componentsSchema = z.object({
  style: z.literal("radix-nova"),
  rtl: z.literal(true),
  aliases: z.object({ ui: z.literal("@/components/ui/primitives") }),
});

function hashes(): Record<string, string> {
  return Object.fromEntries(
    readdirSync(`${root}/${directory}`)
      .filter((name) => name.endsWith(".tsx"))
      .sort()
      .map((name) => [
        name,
        createHash("sha256")
          .update(readFileSync(`${root}/${directory}/${name}`))
          .digest("hex"),
      ]),
  );
}

function run(args: string[]): void {
  execFileSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    timeout: 300_000,
  });
}

function audit(): void {
  const locked = lockSchema.parse(JSON.parse(readFileSync(`${root}/shadcn.lock.json`, "utf8")));
  const current = hashes();
  const changed = [...new Set([...Object.keys(locked.files), ...Object.keys(current)])].filter(
    (name) => locked.files[name] !== current[name],
  );
  if (changed.length > 0) {
    console.error(
      `Registry files differ from the reviewed snapshot: ${changed.join(", ")}. Put CRM customizations in adapters; verify intentional updates with bun run ui:record.`,
    );
    process.exit(1);
  }
  console.warn(`Verified ${Object.keys(current).length} pristine shadcn registry files.`);
}

function record(components: string[]): void {
  const { version } = z
    .object({ version: z.string() })
    .parse(JSON.parse(readFileSync(`${root}/node_modules/shadcn/package.json`, "utf8")));
  writeFileSync(
    `${root}/shadcn.lock.json`,
    `${JSON.stringify({ registry: "https://ui.shadcn.com/r/styles/radix-nova", cliVersion: version, reviewedAt: new Date().toISOString(), components, files: hashes() }, null, 2)}\n`,
  );
  console.warn("Recorded the verified shadcn source snapshot.");
}

try {
  // Refuse a misconfigured destination before an overwrite can reach CRM adapters.
  componentsSchema.parse(JSON.parse(readFileSync(`${root}/components.json`, "utf8")));
  const registry = registrySchema.parse(
    JSON.parse(readFileSync(`${root}/shadcn.registry.json`, "utf8")),
  );
  const cli = `${root}/node_modules/shadcn/dist/index.js`;
  switch (process.argv[2] ?? "check") {
    case "check":
      audit();
      run([cli, "add", ...registry.components, "--dry-run"]);
      break;
    case "audit":
      audit();
      break;
    case "update":
      audit();
      run([cli, "add", ...registry.components, "--overwrite", "--yes"]);
      run(["run", "ui:verify"]);
      record(registry.components);
      break;
    case "record":
      run(["run", "ui:verify"]);
      record(registry.components);
      break;
    default:
      console.error("Usage: bun scripts/shadcn.ts check|update|audit|record");
      process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
