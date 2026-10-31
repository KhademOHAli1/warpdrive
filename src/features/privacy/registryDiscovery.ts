import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";
import { err, ok, type Result } from "@/types/result";
import { discoverBoundaryCall } from "./registryBoundaryDiscovery";
import { collectTableBindings, discoverTableCall } from "./registryTableDiscovery";
import type { DiscoveredInventoryItem, InventoryKind, InventorySource } from "./registryTypes";

const SKIP_SOURCE =
  /(?:\.test(?:-helpers|Helpers)?\.|(?:Fake|TestKit|TestHelpers|TestHarness)\.|\/__fixtures__\/|\/db\/testing\/|\/test\/)/;
const BOUNDARY_CONFIG_SOURCES = new Set([
  "src/config/env.ts",
  "src/constants/fileEntityTypes.ts",
  "src/constants/jobNames.ts",
  "src/features/release/constants.ts",
  "src/features/observability/telemetryConfig.ts",
]);

export async function collectInventorySources(
  root: string,
  signal: AbortSignal,
): Promise<Result<InventorySource[], { code: "inventory_read_failed" }>> {
  const sources: InventorySource[] = [];
  async function walk(directory: string): Promise<void> {
    signal.throwIfAborted();
    for (const item of await readdir(directory, { withFileTypes: true })) {
      signal.throwIfAborted();
      const full = join(directory, item.name);
      if (item.isDirectory()) await walk(full);
      else if (
        /\.tsx?$/.test(item.name) &&
        !SKIP_SOURCE.test(full) &&
        item.name !== "attachmentSend.helpers.ts"
      ) {
        sources.push({
          path: relative(root, full).split("\\").join("/"),
          source: await readFile(full, { encoding: "utf8", signal }),
        });
      }
    }
  }
  try {
    await walk(join(root, "src"));
    await walk(join(root, "scripts"));
    signal.throwIfAborted();
    return ok(sources.sort((a, b) => a.path.localeCompare(b.path)));
  } catch {
    signal.throwIfAborted();
    return err({ code: "inventory_read_failed" });
  }
}

function collectStrings(files: ts.SourceFile[]): Map<string, string> {
  const strings = new Map<string, string>();
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isStringLiteral(node.initializer)
    )
      strings.set(node.name.text, node.initializer.text);
    ts.forEachChild(node, visit);
  }
  for (const file of files) visit(file);
  return strings;
}

export function discoverInventorySources(
  sources: InventorySource[],
  signal: AbortSignal,
): DiscoveredInventoryItem[] {
  signal.throwIfAborted();
  const files = sources.map((item) => {
    signal.throwIfAborted();
    return ts.createSourceFile(item.path, item.source, ts.ScriptTarget.Latest, true);
  });
  const strings = collectStrings(files);
  const items = new Map<string, DiscoveredInventoryItem>();
  function add(kind: InventoryKind, name: string, file: ts.SourceFile): void {
    const id = `${kind}:${name}`;
    items.set(id, { id, kind, source: file.fileName });
  }
  for (const file of files) {
    signal.throwIfAborted();
    const initialCount = items.size;
    const tableBindings = collectTableBindings(file);
    function visit(node: ts.Node): void {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text.includes("QUEUE") &&
        node.initializer !== undefined &&
        ts.isStringLiteral(node.initializer)
      )
        add("queue", node.initializer.text, file);
      if (
        ts.isNewExpression(node) &&
        ["Map", "WeakMap", "Set", "QueryClient"].includes(node.expression.getText(file))
      )
        add("derived", file.fileName, file);
      if (ts.isCallExpression(node)) {
        discoverBoundaryCall(node, file, strings, add);
        discoverTableCall(node, file, tableBindings, add);
      }
      if (
        ts.isFunctionDeclaration(node) &&
        node.name !== undefined &&
        /(?:ObjectKey|UploadKey)$/.test(node.name.text)
      )
        add("objectNamespace", `${file.fileName}#${node.name.text}`, file);
      ts.forEachChild(node, visit);
    }
    visit(file);
    if (items.size > initialCount || BOUNDARY_CONFIG_SOURCES.has(file.fileName))
      add(
        "sourceReview",
        `${file.fileName}#${createHash("sha256").update(file.text).digest("hex")}`,
        file,
      );
  }
  return [...items.values()].sort((a, b) => a.id.localeCompare(b.id));
}
