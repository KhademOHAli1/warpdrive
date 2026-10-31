import ts from "typescript";
import type { InventoryKind } from "./registryTypes";

type AddItem = (kind: InventoryKind, name: string, file: ts.SourceFile) => void;
const EFFECT_METHODS = new Set([
  "send",
  "write",
  "insert",
  "update",
  "delete",
  "execute",
  "presignPost",
  "copyObject",
  "deleteObject",
  "putObject",
  "removeObject",
  "sendMail",
  "setItem",
  "removeItem",
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "query",
  "q",
]);
const QUEUE_METHODS = new Set([
  "send",
  "work",
  "createQueue",
  "schedule",
  "registerBatchWorker",
  "enqueueBatchJob",
]);

function argumentName(node: ts.Expression | undefined, source: ts.SourceFile): string {
  if (node === undefined) return "none";
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isTaggedTemplateExpression(node)) return node.tag.getText(source);
  return "dynamic";
}

function queueBoundary(
  node: ts.CallExpression,
  file: ts.SourceFile,
  method: string,
  strings: Map<string, string>,
  add: AddItem,
): void {
  if (!QUEUE_METHODS.has(method)) return;
  const argument = node.arguments[0];
  const name = argumentName(argument, file);
  const isBoss =
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.expression.getText(file).includes("boss");
  if (!name.includes("QUEUE") && !isBoss) return;
  const queue =
    argument !== undefined && ts.isStringLiteral(argument)
      ? argument.text
      : (strings.get(name) ?? `unresolved:${file.fileName}#${name}`);
  add("queue", queue, file);
}

function objectBoundary(
  node: ts.CallExpression,
  file: ts.SourceFile,
  method: string,
  add: AddItem,
): void {
  const argument = node.arguments[0];
  if (!["presignPost", "putObject", "copyObject"].includes(method) || argument === undefined)
    return;
  const prefix = ts.isTemplateExpression(argument)
    ? argument.head.text
    : ts.isStringLiteral(argument)
      ? argument.text
      : "";
  if (prefix.includes("/"))
    add("objectNamespace", prefix.slice(0, prefix.lastIndexOf("/") + 1), file);
}

function sdkBoundary(
  node: ts.CallExpression,
  file: ts.SourceFile,
  method: string,
  add: AddItem,
): void {
  if (!ts.isPropertyAccessExpression(node.expression)) return;
  const receiver = node.expression.expression.getText(file);
  if (receiver === "console" && ["warn", "error", "log", "info", "debug"].includes(method))
    add("log", `${file.fileName}#${method}`, file);
  if (
    receiver.includes("posthog") &&
    ["init", "identify", "capture", "captureException", "reset"].includes(method)
  )
    add("external", `${file.fileName}#${method}`, file);
}

export function discoverBoundaryCall(
  node: ts.CallExpression,
  file: ts.SourceFile,
  strings: Map<string, string>,
  add: AddItem,
): void {
  const expression = node.expression;
  const method = ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : ts.isIdentifier(expression)
      ? expression.text
      : "";
  const argument = node.arguments[0];
  const name = argumentName(argument, file);
  if (EFFECT_METHODS.has(method)) add("writer", `${file.fileName}#${method}:${name}`, file);
  if (method === "fetch" || method === "sendMail")
    add("external", `${file.fileName}#${method}`, file);
  if (["getItem", "setItem", "removeItem"].includes(method))
    add("browserStore", `${file.fileName}#${name}`, file);
  if (["setQueryData", "setQueriesData", "invalidateQueries", "resetQueries"].includes(method))
    add("derived", `${file.fileName}#${method}`, file);
  queueBoundary(node, file, method, strings, add);
  objectBoundary(node, file, method, add);
  sdkBoundary(node, file, method, add);
}
