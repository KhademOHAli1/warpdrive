import ts from "typescript";
import { SourceBindings, unwrapCopyExpression } from "./sourceBindings";

const MAX_DEPTH = 64;
const MAX_STEPS = 50_000;
export class SourceAnalysisLimitError extends Error {}
export interface CopyOrigin {
  text: string;
  node: ts.Expression;
}

export function visibleCopyResolver(tree: ts.SourceFile) {
  const file = tree.fileName;
  let steps = 0;
  const tick = (depth = 0): void => {
    if (++steps > MAX_STEPS || depth > MAX_DEPTH)
      throw new SourceAnalysisLimitError(`Source copy analysis limit exceeded: ${file}`);
  };
  const bindings = new SourceBindings(tree, tick);
  const emitted = new Set<ts.Node>();

  function ownProperties(node: ts.ObjectLiteralExpression): Map<string, ts.Expression> | undefined {
    const properties = new Map<string, ts.Expression>();
    for (const property of node.properties) {
      tick();
      if (!ts.isPropertyAssignment(property)) return undefined;
      const name = property.name;
      if (!ts.isIdentifier(name) && !ts.isStringLiteral(name) && !ts.isNumericLiteral(name))
        return undefined;
      properties.set(name.text, property.initializer);
    }
    return properties;
  }

  function object(
    node: ts.Expression,
    seen: Set<ts.Symbol>,
    depth: number,
  ): ts.ObjectLiteralExpression | undefined {
    tick(depth);
    node = unwrapCopyExpression(node);
    if (ts.isObjectLiteralExpression(node)) return node;
    if (!ts.isIdentifier(node)) return undefined;
    const symbol = bindings.symbol(node);
    if (symbol === undefined || seen.has(symbol)) return undefined;
    const initial = bindings.constant(symbol);
    if (initial === undefined) return undefined;
    return object(initial, new Set([...seen, symbol]), depth + 1);
  }

  function literalKey(
    node: ts.Expression,
    seen: Set<ts.Symbol>,
    depth: number,
  ): string | undefined {
    tick(depth);
    node = unwrapCopyExpression(node);
    if (
      ts.isStringLiteral(node) ||
      ts.isNumericLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    )
      return node.text;
    if (!ts.isIdentifier(node)) return undefined;
    const symbol = bindings.symbol(node);
    if (symbol === undefined || seen.has(symbol)) return undefined;
    const initial = bindings.constant(symbol);
    return initial === undefined
      ? undefined
      : literalKey(initial, new Set([...seen, symbol]), depth + 1);
  }

  function memberKey(
    node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    depth: number,
  ): string | undefined {
    return ts.isPropertyAccessExpression(node)
      ? node.name.text
      : literalKey(node.argumentExpression, new Set(), depth);
  }

  return (expression: ts.Expression): CopyOrigin[] => {
    const found: CopyOrigin[] = [];
    const active = new Set<ts.Node>();
    const symbols = new Set<ts.Symbol>();
    const emit = (text: string, node: ts.Expression): void => {
      if (emitted.has(node)) return;
      emitted.add(node);
      found.push({ text, node });
    };
    const updaterReturns = (node: ts.Expression, depth: number): void => {
      if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
        walk(node, depth);
        return;
      }
      if (!ts.isBlock(node.body)) {
        walk(node.body, depth + 1);
        return;
      }
      const visit = (child: ts.Node): void => {
        tick(depth);
        if (ts.isFunctionLike(child)) return;
        if (ts.isReturnStatement(child) && child.expression !== undefined)
          walk(child.expression, depth + 1);
        else ts.forEachChild(child, visit);
      };
      visit(node.body);
    };
    const binary = (node: ts.BinaryExpression, depth: number): void => {
      const operator = node.operatorToken.kind;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) walk(node.right, depth + 1);
      else if (
        [
          ts.SyntaxKind.PlusToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(operator)
      ) {
        walk(node.left, depth + 1);
        walk(node.right, depth + 1);
      }
    };
    const identifier = (node: ts.Identifier, depth: number): void => {
      const symbol = bindings.symbol(node);
      if (symbol === undefined || symbols.has(symbol)) return;
      symbols.add(symbol);
      const initial = bindings.constant(symbol);
      if (initial !== undefined) walk(initial, depth + 1);
      else
        for (const value of bindings.state(symbol) ?? [])
          updaterReturns(unwrapCopyExpression(value), depth + 1);
      symbols.delete(symbol);
    };
    const member = (
      node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
      depth: number,
    ): void => {
      const receiver = object(node.expression, new Set(), depth + 1);
      if (receiver === undefined) return;
      const values = ownProperties(receiver);
      if (values === undefined) return;
      const key = memberKey(node, depth + 1);
      const selected = key === undefined ? [...values.values()] : [values.get(key)];
      for (const value of selected) if (value !== undefined) walk(value, depth + 1);
    };
    const visitExpression = (node: ts.Expression, depth: number): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        emit(node.text, node);
      else if (ts.isTemplateExpression(node))
        emit(
          node.head.text + node.templateSpans.map((span) => `{…}${span.literal.text}`).join(""),
          node,
        );
      else if (ts.isConditionalExpression(node)) {
        walk(node.whenTrue, depth + 1);
        walk(node.whenFalse, depth + 1);
      } else if (ts.isBinaryExpression(node)) binary(node, depth);
      else if (ts.isIdentifier(node)) identifier(node, depth);
      else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        member(node, depth);
    };
    const walk = (node: ts.Expression, depth: number): void => {
      tick(depth);
      node = unwrapCopyExpression(node);
      if (active.has(node)) return;
      active.add(node);
      visitExpression(node, depth);
      active.delete(node);
    };
    walk(expression, 0);
    return found;
  };
}
