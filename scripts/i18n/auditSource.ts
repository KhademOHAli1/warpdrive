import { createHash } from "node:crypto";
import ts from "typescript";
import { visibleCopyResolver } from "./sourceCopy";

export interface SourceFinding {
  kind: "literal" | "legacy-catalog";
  file: string;
  line: number;
  text: string;
  id: string;
}

const COPY_ATTRIBUTES = new Set([
  "alt",
  "title",
  "placeholder",
  "label",
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
]);

function hasRuntimeImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined) return true;
  const bindings = clause.namedBindings;
  return (
    bindings === undefined ||
    !ts.isNamedImports(bindings) ||
    bindings.elements.some((item) => !item.isTypeOnly)
  );
}

// This finds migration candidates, including bounded local bindings and rendered React state.
// Arbitrary helpers, imported data and server-returned errors still need feature review.
export function auditSource(source: string, file: string): SourceFinding[] {
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const findings: SourceFinding[] = [];
  const visibleCopy = visibleCopyResolver(tree);
  const roots: ts.Expression[] = [];
  const literalOrigins = new Set<ts.Node>();
  const occurrences = new Map<string, number>();

  function add(kind: SourceFinding["kind"], text: string, node: ts.Node): void {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!/\p{L}/u.test(normalized)) return;
    if (kind === "literal") literalOrigins.add(node);
    const signature = `${kind}:${file}:${normalized}`;
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    findings.push({
      kind,
      file,
      text: normalized,
      line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
      id: createHash("sha256").update(`${signature}:${occurrence}`).digest("hex").slice(0, 20),
    });
  }

  function expression(node: ts.Expression): void {
    roots.push(node);
    directExpression(node);
  }

  function directExpression(node: ts.Expression): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      add("literal", node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      add(
        "literal",
        node.head.text + node.templateSpans.map((span) => `{…}${span.literal.text}`).join(""),
        node,
      );
    } else if (ts.isConditionalExpression(node)) {
      directExpression(node.whenTrue);
      directExpression(node.whenFalse);
    } else if (ts.isParenthesizedExpression(node)) {
      directExpression(node.expression);
    } else if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) directExpression(node.right);
      else if (
        [
          ts.SyntaxKind.PlusToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(operator)
      ) {
        directExpression(node.left);
        directExpression(node.right);
      }
    }
  }

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node) &&
      hasRuntimeImport(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const moduleName = node.moduleSpecifier.text;
      // The old single-language catalogs live in constants/. Feature-local factories
      // may retain a Strings suffix while resolving typed messages per viewer.
      if (/(?:^|\/)constants\/(?:strings|[A-Za-z]+Strings)$/.test(moduleName))
        add("legacy-catalog", moduleName, node);
    }
    if (ts.isJsxText(node)) add("literal", node.text, node);
    if (ts.isJsxAttribute(node) && COPY_ATTRIBUTES.has(node.name.getText(tree))) {
      if (node.initializer !== undefined && ts.isStringLiteral(node.initializer)) {
        add("literal", node.initializer.text, node.initializer);
      } else if (
        node.initializer !== undefined &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression !== undefined
      ) {
        expression(node.initializer.expression);
      }
    }
    if (
      ts.isJsxExpression(node) &&
      !ts.isJsxAttribute(node.parent) &&
      node.expression !== undefined
    ) {
      expression(node.expression);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  // Keep legacy literal occurrences first so extending coverage cannot renumber existing IDs.
  for (const node of roots)
    for (const origin of visibleCopy(node))
      if (!literalOrigins.has(origin.node)) add("literal", origin.text, origin.node);
  return findings;
}
