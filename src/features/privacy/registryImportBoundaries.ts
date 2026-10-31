import ts from "typescript";
import type { InventoryKind } from "./registryTypes";

type Domain = "http" | "https" | "filesystem";
type AddItem = (kind: InventoryKind, name: string, file: ts.SourceFile) => void;
const MODULES = new Map<string, Domain>([
  ["http", "http"],
  ["node:http", "http"],
  ["https", "https"],
  ["node:https", "https"],
  ["fs", "filesystem"],
  ["node:fs", "filesystem"],
  ["fs/promises", "filesystem"],
  ["node:fs/promises", "filesystem"],
]);
const FILE_METHODS = new Set([
  "open",
  "openSync",
  "readFile",
  "readFileSync",
  "createReadStream",
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
]);
interface Boundary {
  domain: Domain;
  method: string;
}
interface ImportBoundaries {
  direct: Map<string, Boundary>;
  namespaces: Map<string, Domain>;
}

function collectClause(clause: ts.ImportClause, domain: Domain, imports: ImportBoundaries): void {
  if (clause.name !== undefined) imports.namespaces.set(clause.name.text, domain);
  const bindings = clause.namedBindings;
  if (bindings === undefined) return;
  if (ts.isNamespaceImport(bindings)) {
    imports.namespaces.set(bindings.name.text, domain);
    return;
  }
  for (const imported of bindings.elements) {
    if (!imported.isTypeOnly)
      imports.direct.set(imported.name.text, {
        domain,
        method: imported.propertyName?.text ?? imported.name.text,
      });
  }
}

export function collectImportBoundaries(file: ts.SourceFile): ImportBoundaries {
  const direct = new Map<string, Boundary>();
  const namespaces = new Map<string, Domain>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const domain = MODULES.get(statement.moduleSpecifier.text);
    const clause = statement.importClause;
    if (domain === undefined || clause === undefined || clause.isTypeOnly) continue;
    collectClause(clause, domain, { direct, namespaces });
  }
  return { direct, namespaces };
}

function importedCall(
  expression: ts.LeftHandSideExpression,
  imports: ImportBoundaries,
): Boundary | undefined {
  if (ts.isIdentifier(expression)) return imports.direct.get(expression.text);
  if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression))
    return undefined;
  const domain = imports.namespaces.get(expression.expression.text);
  return domain === undefined ? undefined : { domain, method: expression.name.text };
}

function argumentName(argument: ts.Expression | undefined): string {
  if (argument === undefined) return "none";
  if (ts.isIdentifier(argument) || ts.isStringLiteral(argument)) return argument.text;
  return "dynamic";
}

export function discoverImportedBoundary(
  node: ts.CallExpression,
  file: ts.SourceFile,
  imports: ImportBoundaries,
  add: AddItem,
): void {
  const boundary = importedCall(node.expression, imports);
  if (boundary === undefined) return;
  const { domain, method } = boundary;
  if (domain !== "filesystem") {
    if (method === "request" || method === "get")
      add("external", `${file.fileName}#${domain}.${method}`, file);
    return;
  }
  if (!FILE_METHODS.has(method)) return;
  const name = argumentName(node.arguments[0]);
  add("objectNamespace", `filesystem:${file.fileName}#${method}:${name}`, file);
}
