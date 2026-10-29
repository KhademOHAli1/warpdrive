import ts from "typescript";

export function unwrapCopyExpression(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  )
    node = node.expression;
  return node;
}

function declaration(symbol: ts.Symbol): ts.Declaration | undefined {
  return symbol.valueDeclaration ?? symbol.declarations?.[0];
}

export class SourceBindings {
  private checker: ts.TypeChecker | undefined;
  private states: Map<ts.Symbol, ts.Expression[]> | undefined;

  constructor(
    private tree: ts.SourceFile,
    private tick: () => void,
  ) {}

  symbol(node: ts.Node): ts.Symbol | undefined {
    if (this.checker === undefined) {
      // Bind only this parsed file. No library, module, directory or filesystem lookup is allowed.
      const name = "/__i18n__/source.tsx";
      this.tree.fileName = name;
      const host: ts.CompilerHost = {
        getSourceFile: (path) => (path === name ? this.tree : undefined),
        getDefaultLibFileName: () => "",
        writeFile: () => {},
        getCurrentDirectory: () => "/__i18n__",
        getDirectories: () => [],
        directoryExists: () => false,
        fileExists: (path) => path === name,
        readFile: (path) => (path === name ? this.tree.text : undefined),
        getCanonicalFileName: (path) => path,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
      };
      this.checker = ts
        .createProgram(
          [name],
          {
            noLib: true,
            noResolve: true,
            jsx: ts.JsxEmit.Preserve,
            target: ts.ScriptTarget.Latest,
          },
          host,
        )
        .getTypeChecker();
    }
    return this.checker.getSymbolAtLocation(node);
  }

  constant(symbol: ts.Symbol): ts.Expression | undefined {
    const node = declaration(symbol);
    if (node === undefined || !ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name))
      return undefined;
    if (!ts.isVariableDeclarationList(node.parent) || !(node.parent.flags & ts.NodeFlags.Const))
      return undefined;
    return node.initializer;
  }

  state(symbol: ts.Symbol): ts.Expression[] | undefined {
    const node = declaration(symbol);
    if (node === undefined || !ts.isBindingElement(node)) return undefined;
    this.indexStates();
    return this.states?.get(symbol);
  }

  private reactImport(node: ts.Node): ts.ImportDeclaration | undefined {
    let current = node;
    while (!ts.isSourceFile(current) && !ts.isImportDeclaration(current)) current = current.parent;
    if (!ts.isImportDeclaration(current)) return undefined;
    return ts.isStringLiteral(current.moduleSpecifier) &&
      current.moduleSpecifier.text === "react" &&
      current.importClause?.isTypeOnly !== true
      ? current
      : undefined;
  }

  private isStateHook(expression: ts.Expression): boolean {
    const callee = unwrapCopyExpression(expression);
    if (ts.isIdentifier(callee)) {
      const symbol = this.symbol(callee);
      const node = symbol === undefined ? undefined : declaration(symbol);
      return (
        node !== undefined &&
        ts.isImportSpecifier(node) &&
        !node.isTypeOnly &&
        (node.propertyName ?? node.name).text === "useState" &&
        this.reactImport(node) !== undefined
      );
    }
    if (
      !ts.isPropertyAccessExpression(callee) ||
      callee.name.text !== "useState" ||
      !ts.isIdentifier(callee.expression)
    )
      return false;
    const symbol = this.symbol(callee.expression);
    const node = symbol === undefined ? undefined : declaration(symbol);
    return (
      node !== undefined &&
      (ts.isNamespaceImport(node) || ts.isImportClause(node)) &&
      this.reactImport(node) !== undefined
    );
  }

  private scan(visitor: (node: ts.Node) => void): void {
    const visit = (node: ts.Node): void => {
      this.tick();
      visitor(node);
      ts.forEachChild(node, visit);
    };
    visit(this.tree);
  }

  private indexStates(): void {
    if (this.states !== undefined) return;
    const states = new Map<ts.Symbol, ts.Expression[]>();
    const setters = new Map<ts.Symbol, ts.Expression[]>();
    this.states = states;
    this.scan((node) => {
      if (
        !ts.isVariableDeclaration(node) ||
        !ts.isVariableDeclarationList(node.parent) ||
        (node.parent.flags & ts.NodeFlags.Const) === 0 ||
        !ts.isArrayBindingPattern(node.name) ||
        node.name.elements.length !== 2 ||
        node.initializer === undefined
      )
        return;
      const call = unwrapCopyExpression(node.initializer);
      if (!ts.isCallExpression(call) || !this.isStateHook(call.expression)) return;
      const [getter, setter] = node.name.elements;
      if (
        getter === undefined ||
        setter === undefined ||
        !ts.isBindingElement(getter) ||
        !ts.isBindingElement(setter) ||
        !ts.isIdentifier(getter.name) ||
        !ts.isIdentifier(setter.name)
      )
        return;
      const getterSymbol = this.symbol(getter.name);
      const setterSymbol = this.symbol(setter.name);
      if (getterSymbol === undefined || setterSymbol === undefined) return;
      const initial = call.arguments[0];
      const values = initial === undefined ? [] : [initial];
      states.set(getterSymbol, values);
      setters.set(setterSymbol, values);
    });
    this.scan((node) => {
      if (!ts.isCallExpression(node)) return;
      const callee = unwrapCopyExpression(node.expression);
      if (!ts.isIdentifier(callee)) return;
      const symbol = this.symbol(callee);
      const values = symbol === undefined ? undefined : setters.get(symbol);
      const value = node.arguments[0];
      if (values !== undefined && value !== undefined) values.push(value);
    });
  }
}
