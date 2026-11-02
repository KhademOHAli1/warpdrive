import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildClientPackage } from "../src/features/integrations/clientPackages.ts";

const { values } = parseArgs({
  options: { "base-url": { type: "string" }, output: { type: "string" } },
});
if (!values["base-url"] || !values.output)
  throw new Error(
    "Usage: bun scripts/build-client-plugins.mjs --base-url=https://crm.example.com --output=/new/output/directory",
  );
const packages = ["chatgpt", "claude"].map((client) => {
  const built = buildClientPackage(values["base-url"], client);
  if (!built.ok)
    throw new Error(
      "base-url must be a public HTTPS origin without credentials, a path, query, or fragment",
    );
  return { client, files: built.value };
});
const output = path.resolve(values.output);
// Deliberately refuse to overwrite an existing package or a user's files.
await mkdir(output);
for (const { client, files } of packages) {
  for (const [name, contents] of Object.entries(files)) {
    const destination = path.join(output, client, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents, { flag: "wx" });
  }
}
