import ts from "typescript";
import type { InventoryKind } from "./registryTypes";

interface TableBindings {
  factories: Set<string>;
  schemas: Map<string, string>;
}
type AddItem = (kind: InventoryKind, name: string, file: ts.SourceFile) => void;

export function collectTableBindings(file: ts.SourceFile): TableBindings {
  const factories = new Set(["pgTable"]);
  const schemaFactories = new Set(["pgSchema"]);
  const schemas = new Map<string, string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "drizzle-orm/pg-core"
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      const imported = binding.propertyName?.text ?? binding.name.text;
      if (imported === "pgTable") factories.add(binding.name.text);
      if (imported === "pgSchema") schemaFactories.add(binding.name.text);
    }
  }
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    )
      collectVariable(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  }
  function collectVariable(name: string, expression: ts.Expression): void {
    if (ts.isIdentifier(expression) && factories.has(expression.text)) factories.add(name);
    if (
      !ts.isCallExpression(expression) ||
      !ts.isIdentifier(expression.expression) ||
      !schemaFactories.has(expression.expression.text)
    )
      return;
    const schema = expression.arguments[0];
    schemas.set(
      name,
      schema !== undefined && ts.isStringLiteral(schema)
        ? schema.text
        : `dynamicSchema:${file.fileName}`,
    );
  }
  visit(file);
  return { factories, schemas };
}

export function discoverTableCall(
  node: ts.CallExpression,
  file: ts.SourceFile,
  bindings: TableBindings,
  add: AddItem,
): void {
  const expression = node.expression;
  const method = ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : ts.isIdentifier(expression)
      ? expression.text
      : "";
  if (!bindings.factories.has(method) && method !== "table") return;
  const argument = node.arguments[0];
  const name =
    argument !== undefined && ts.isStringLiteralLike(argument)
      ? argument.text
      : `dynamic:${file.fileName}`;
  if (method !== "table") {
    add("table", name, file);
    return;
  }
  const schema = ts.isPropertyAccessExpression(expression)
    ? bindings.schemas.get(expression.expression.getText(file))
    : undefined;
  add("table", `${schema ?? `dynamicSchema:${file.fileName}`}.${name}`, file);
}
