import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, mkdtemp, open, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENTS, generateComponentInputs, parseInputArguments } from "./component_inputs.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const NAMESPACE = "src/features/operations/messages/operations";
const CATALOG = "src/features/i18n/catalog.ts";
const NEXT = "next.config.ts";
const UI_COPY = "src/components/data-table/messages/tableControls.en.json";
const MAIL_COPY = "src/features/notifications/messages/notificationEmail.en.json";
const hashes = (receipt) =>
  Object.fromEntries(
    COMPONENTS.map((component) => [component, receipt.components[component].componentInputSha256]),
  );

function changed(before, after) {
  assert.equal(before.inputPolicySha256, after.inputPolicySha256, "Policy must stay identical");
  return COMPONENTS.filter((component) => hashes(before)[component] !== hashes(after)[component]);
}

async function copySnapshot(root, destination, receipt) {
  // The conservative Web inventory includes every declared Core input and bounds both
  // count and bytes. Check each copied byte against that already resolved inventory.
  const copied = new Set(receipt.components.web.inputs.map((input) => input.path));
  for (const component of COMPONENTS) {
    for (const input of receipt.components[component].inputs)
      assert(copied.has(input.path), `Web snapshot omitted ${component} input ${input.path}`);
  }
  for (const input of receipt.components.web.inputs) {
    const handle = await open(join(root, input.path), constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes;
    try {
      const stat = await handle.stat();
      assert(stat.isFile() && stat.size === input.bytes, "Snapshot source changed");
      bytes = await handle.readFile();
      assert.equal(bytes.length, input.bytes, "Snapshot source size changed");
      assert.equal(sha256(bytes), input.sha256, "Snapshot source content changed");
    } finally {
      await handle.close();
    }
    const target = join(destination, input.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  }
  // Tooling packages are resolved from the existing locked installation; never install
  // or write into it. node_modules is explicitly outside component source inventories.
  await symlink(
    await realpath(join(root, "node_modules")),
    join(destination, "node_modules"),
    "dir",
  );
}

function removeExactlyOnce(text, line) {
  assert.equal(text.split(line).length, 2, `Expected one namespace registration: ${line.trim()}`);
  return text.replace(line, "");
}

export async function qualifyComponentBoundaries(options) {
  const root = await realpath(
    resolve(options.root ?? resolve(dirname(fileURLToPath(import.meta.url)), "../..")),
  );
  const current = await generateComponentInputs({ ...options, root });
  assert.deepEqual(Object.keys(current.components), COMPONENTS, "All four components required");
  const snapshot = await mkdtemp(join(tmpdir(), "warpdrive-component-boundaries-"));
  const started = performance.now();
  const report = {
    schemaVersion: 1,
    kind: "warpdrive-real-source-component-boundaries",
    success: false,
    inputPolicySha256: current.inputPolicySha256,
    sourceInputs: hashes(current),
    checks: [],
    limitations: [
      "Input dependency boundaries in an owned real-source snapshot, not runtime or image qualification.",
      "Web still uses the conservative repository inventory; worker-only Web reuse is not qualified.",
      "No component reuse, deployment, API/WS/job compatibility or installed acceptance is authorized.",
    ],
  };
  try {
    await copySnapshot(root, snapshot, current);
    const discover = () => generateComponentInputs({ ...options, root: snapshot });
    const saved = new Map();
    for (const path of [
      CATALOG,
      NEXT,
      ...["en", "de", "fa"].map((locale) => `${NAMESPACE}.${locale}.json`),
    ])
      saved.set(path, await readFile(join(snapshot, path), "utf8"));

    // Start without this actual feature namespace, then register the exact current
    // translations/configuration. This exercises fresh production esbuild resolution.
    let catalog = saved.get(CATALOG);
    for (const [name, locale] of [
      ["English", "en"],
      ["German", "de"],
      ["Persian", "fa"],
    ]) {
      catalog = removeExactlyOnce(
        catalog,
        `import operations${name} from "@/features/operations/messages/operations.${locale}.json";\n`,
      );
      catalog = removeExactlyOnce(catalog, `  operations: operations${name},\n`);
      await rm(join(snapshot, `${NAMESPACE}.${locale}.json`));
    }
    await writeFile(join(snapshot, CATALOG), catalog);
    await writeFile(
      join(snapshot, NEXT),
      removeExactlyOnce(saved.get(NEXT), `      "./${NAMESPACE}.en.json",\n`),
    );
    const beforeRegistration = await discover();
    for (const [path, bytes] of saved) await writeFile(join(snapshot, path), bytes);
    const afterRegistration = await discover();
    assert.deepEqual(
      hashes(afterRegistration),
      hashes(current),
      "Copied source must resolve identically",
    );
    assert.deepEqual(
      changed(beforeRegistration, afterRegistration),
      ["web"],
      "UI namespace must affect Web alone",
    );
    report.checks.push({
      name: "actual-operations-ui-namespace-registration",
      passed: true,
      before: hashes(beforeRegistration),
      after: hashes(afterRegistration),
    });

    const uiOriginal = await readFile(join(snapshot, UI_COPY), "utf8");
    const ui = JSON.parse(uiOriginal);
    assert.equal(typeof ui.clearSelection, "string");
    ui.clearSelection += " boundary proof";
    await writeFile(join(snapshot, UI_COPY), JSON.stringify(ui));
    const afterUiCopy = await discover();
    assert.deepEqual(
      changed(afterRegistration, afterUiCopy),
      ["web"],
      "UI copy must affect Web alone",
    );
    report.checks.push({
      name: "existing-table-controls-ui-copy",
      passed: true,
      before: hashes(afterRegistration),
      after: hashes(afterUiCopy),
    });
    await writeFile(join(snapshot, UI_COPY), uiOriginal);

    const mail = JSON.parse(await readFile(join(snapshot, MAIL_COPY), "utf8"));
    assert.equal(typeof mail.recipientFallback, "string");
    mail.recipientFallback += " boundary proof";
    await writeFile(join(snapshot, MAIL_COPY), JSON.stringify(mail));
    const afterMailCopy = await discover();
    assert.deepEqual(
      changed(afterRegistration, afterMailCopy),
      ["web", "worker"],
      "Mail copy must invalidate Worker",
    );
    report.checks.push({
      name: "notification-mail-copy-positive-control",
      passed: true,
      before: hashes(afterRegistration),
      after: hashes(afterMailCopy),
    });
    report.success = true;
  } finally {
    // rm never follows the dependency directory symlink. All mutations stayed here.
    await rm(snapshot, { recursive: true, force: true });
    report.cleanupSuccess = true;
    report.seconds = Math.round((performance.now() - started) / 10) / 100;
  }
  return report;
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1]))) === (await realpath(fileURLToPath(import.meta.url)))
) {
  try {
    // Like the input producer, publication is stdout-only. The CI caller retains
    // this report under its own RUNNER_TEMP; no caller-chosen path is opened here.
    const report = await qualifyComponentBoundaries(parseInputArguments(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Component boundary qualification failed",
    );
    process.exitCode = 1;
  }
}
