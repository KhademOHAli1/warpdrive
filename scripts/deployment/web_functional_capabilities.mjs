/** Finite client capability grants for the functional Web v2 source policy. */
import { createHash } from "node:crypto";
import ts from "typescript";
import { canonical } from "./component_inputs.mjs";

const UI_SEGMENT = /^[A-Za-z0-9_-]+$/u;
const APP_SEGMENT =
  /^(?:@[A-Za-z0-9_-]+|\([A-Za-z0-9_-]+\)|(?:\(\.\)|\(\.\.\)|\(\.\.\.\)|\(\.\.\)\(\.\.\))?(?:[A-Za-z0-9_-]+|\[(?:\.\.\.)?[A-Za-z0-9_-]+\]|\[\[\.\.\.[A-Za-z0-9_-]+\]\]))$/u;
const PROTECTED_SEGMENTS = new Set([
  "api",
  "auth",
  "actions",
  "action",
  "server",
  "db",
  "config",
  "jobs",
  "routers",
  "trpc",
  "migrations",
]);
const PROTECTED_LEAVES = new Set([
  ...PROTECTED_SEGMENTS,
  "index",
  "route",
  "middleware",
  "proxy",
  "instrumentation",
  "instrumentation-client",
  "loading",
  "error",
  "global-error",
  "global-not-found",
  "not-found",
  "template",
  "default",
  "forbidden",
  "unauthorized",
  "robots",
  "sitemap",
  "manifest",
  "favicon",
]);
const HOOK = /^use[A-Z][A-Za-z0-9]{0,60}$/u;
const COMPONENT = /^[A-Z][A-Za-z0-9]{0,63}$/u;

function exact(value, names) {
  return (
    value &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join(",") === names
  );
}

function reviewedPath(path, role) {
  if (typeof path !== "string" || path.length > 240) return false;
  const parts = path.split("/");
  if (parts.length < 3 || parts[0] !== "src") return false;
  const app = parts[1] === "app" && parts[2] === "(app)" && role !== "capability";
  let dirs;
  if (app) dirs = parts.slice(3, -1);
  else if (parts[1] === "components") dirs = parts.slice(2, -1);
  else if (parts.length >= 5 && parts[1] === "features" && parts[3] === "ui")
    dirs = [parts[2], ...parts.slice(4, -1)];
  else return false;
  const pattern = app ? APP_SEGMENT : UI_SEGMENT;
  if (
    dirs.some(
      (part) =>
        !pattern.test(part) ||
        PROTECTED_SEGMENTS.has(part.toLowerCase().replace(/[()@[\].]+/gu, "")),
    )
  )
    return false;
  const suffix =
    role === "styles" ? /^([A-Za-z0-9_-]+)\.module\.css$/u : /^([A-Za-z0-9_-]+)\.tsx?$/u;
  const leaf = suffix.exec(parts[parts.length - 1])?.[1]?.toLowerCase();
  if (!leaf) return false;
  if (leaf === "page" || leaf === "layout") return app && role === "adapters";
  return (
    !PROTECTED_LEAVES.has(leaf) &&
    !/^(?:icon|apple-icon|opengraph-image|twitter-image)\d*$/u.test(leaf)
  );
}

function sortedUnique(list) {
  return [...list].every(
    (value, index) => typeof value === "string" && (index === 0 || list[index - 1] < value),
  );
}

function checkedPaths(value, role, reject) {
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
    ![...value].every((path) => reviewedPath(path, role)) ||
    !sortedUnique(value)
  )
    reject(`Invalid exact functional Web v2 ${role} paths`);
  return value;
}

function validExport(item) {
  return (
    exact(item, "kind,name") &&
    typeof item.name === "string" &&
    ((item.kind === "hook" && HOOK.test(item.name)) ||
      (item.kind === "component" && COMPONENT.test(item.name)))
  );
}

export function readCapabilityProfile(profile, reject) {
  if (!exact(profile, "adapters,capabilities,modules,styles,version") || profile.version !== 2)
    reject("Unsupported functional Web v2 profile");
  const modules = checkedPaths(profile.modules, "modules", reject);
  const styles = checkedPaths(profile.styles, "styles", reject);
  const adapters = checkedPaths(profile.adapters, "adapters", reject);
  const allowed = new Set(modules);
  const capabilities = profile.capabilities;
  if (
    !modules.length ||
    !adapters.length ||
    !Array.isArray(capabilities) ||
    capabilities.length > 32
  )
    reject("Bounded functional Web v2 modules, mounts and capabilities required");
  let grants = 0;
  for (const item of capabilities) {
    if (
      !exact(item, "consumers,exports,path") ||
      !reviewedPath(item.path, "capability") ||
      !Array.isArray(item.exports) ||
      !item.exports.length ||
      item.exports.length > 16 ||
      ![...item.exports].every(validExport) ||
      !sortedUnique(item.exports.map(({ name }) => name))
    )
      reject("Exact functional Web capability path and named exports required");
    const consumers = checkedPaths(item.consumers, "modules", reject);
    if (!consumers.length || !consumers.every((path) => allowed.has(path)))
      reject("Exact declared functional Web capability consumers required");
    grants += consumers.length * item.exports.length;
  }
  const capabilityPaths = capabilities.map(({ path }) => path);
  const paths = [...modules, ...styles, ...adapters, ...capabilityPaths].map((path) =>
    path.toLowerCase(),
  );
  if (
    grants > 512 ||
    !sortedUnique(capabilityPaths) ||
    new Set(paths).size !== paths.length ||
    Buffer.byteLength(canonical(profile)) > 64 * 1024
  )
    reject("Functional Web v2 capability profile overlaps or exceeds its bounds");
  return { version: 2, modules, styles, adapters, capabilities };
}

function explicitlyClient(tree) {
  const directive = tree.statements[0];
  return (
    directive &&
    ts.isExpressionStatement(directive) &&
    ts.isStringLiteral(directive.expression) &&
    directive.expression.text === "use client"
  );
}

function directExport(node) {
  return (
    ts.isFunctionDeclaration(node) &&
    node.parent.kind === ts.SyntaxKind.SourceFile &&
    node.body &&
    node.name &&
    !node.asteriskToken &&
    !node.parameters.length &&
    !node.typeParameters?.length &&
    node.modifiers?.length === 1 &&
    node.modifiers[0].kind === ts.SyntaxKind.ExportKeyword
  );
}

export function verifyCapabilityProvider(tree, contract, reject) {
  if (!explicitlyClient(tree))
    reject(`Protected Web capability requires an explicit client module: ${contract.path}`);
  for (const { name, kind } of contract.exports) {
    const declarations = tree.statements.filter(
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
    );
    const node = declarations[0];
    if (
      declarations.length !== 1 ||
      !directExport(node) ||
      (kind === "hook" && node.type?.kind !== ts.SyntaxKind.BooleanKeyword) ||
      (kind === "component" && !contract.path.endsWith(".tsx"))
    )
      reject(`Unreviewed protected Web capability export shape: ${contract.path}#${name}`);
  }
}

export function capabilityImport({ node, path, contract, bindings, reject }) {
  const clause = node.importClause;
  const named = clause?.namedBindings;
  if (
    !contract.consumers.includes(path) ||
    !clause ||
    clause.isTypeOnly ||
    clause.name ||
    node.attributes ||
    !named ||
    !ts.isNamedImports(named) ||
    !named.elements.length
  )
    reject(`Unreviewed functional Web capability import: ${path}`);
  const exports = new Map(contract.exports.map((item) => [item.name, item.kind]));
  for (const element of named.elements) {
    const name = element.name.text;
    const kind = exports.get(name);
    if (!kind || element.propertyName || element.isTypeOnly || bindings.has(name))
      reject(`Exact unaliased functional Web capability import required: ${path}`);
    bindings.set(name, { kind: `capability-${kind}`, name, path: contract.path });
  }
}

function symbolOf(checker, node) {
  if (ts.isShorthandPropertyAssignment(node.parent))
    return checker.getShorthandAssignmentValueSymbol(node.parent);
  return checker.getSymbolAtLocation(node);
}

function renderOwner(node) {
  let current = node.parent;
  while (current && !ts.isFunctionLike(current)) current = current.parent;
  return current && directExport(current) && COMPONENT.test(current.name.text)
    ? current
    : undefined;
}

function directHookStatement(node, owner) {
  const call = node.parent;
  if (
    !ts.isCallExpression(call) ||
    call.expression !== node ||
    call.questionDotToken ||
    call.typeArguments?.length ||
    call.arguments.length
  )
    return undefined;
  const declaration = call.parent;
  if (
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer !== call ||
    !ts.isIdentifier(declaration.name) ||
    declaration.type
  )
    return undefined;
  const list = declaration.parent;
  const statement = list.parent;
  const direct =
    ts.isVariableDeclarationList(list) &&
    (list.flags & ts.NodeFlags.Const) !== 0 &&
    list.declarations.length === 1 &&
    ts.isVariableStatement(statement) &&
    statement.parent === owner.body;
  return direct ? statement : undefined;
}

function priorStatements(statement, body) {
  return body.statements.slice(0, body.statements.indexOf(statement));
}

function inertHookPrelude(statement, uses) {
  if (!ts.isVariableStatement(statement)) return false;
  return statement.declarationList.declarations.every(({ name, initializer }) => {
    if (!ts.isIdentifier(name)) return false;
    return (
      initializer &&
      (uses.has(initializer) ||
        ts.isStringLiteral(initializer) ||
        ts.isNumericLiteral(initializer) ||
        [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
          initializer.kind,
        ))
    );
  });
}

function directComponentRender(node, owner) {
  const element = node.parent;
  if (
    !ts.isJsxSelfClosingElement(element) ||
    element.tagName !== node ||
    element.attributes.properties.length ||
    element.typeArguments?.length
  )
    return false;
  let current = element.parent;
  while (!ts.isStatement(current)) {
    if (
      !ts.isParenthesizedExpression(current) &&
      !ts.isJsxExpression(current) &&
      !ts.isJsxFragment(current) &&
      !(
        ts.isJsxElement(current) &&
        ts.isIdentifier(current.openingElement.tagName) &&
        /^[a-z][a-z0-9]*$/u.test(current.openingElement.tagName.text)
      )
    )
      return false;
    current = current.parent;
  }
  return (
    ts.isReturnStatement(current) &&
    current.parent === owner.body &&
    priorStatements(current, owner.body).every(ts.isVariableStatement)
  );
}

/** Check every actual import symbol reference, then hand the old grammar only vetted nodes. */
export function verifyCapabilityUses({ tree, path, imports, checker, reject }) {
  const names = new Map(
    [...imports].filter(
      ([, binding]) =>
        binding.kind === "capability-hook" || binding.kind === "capability-component",
    ),
  );
  const symbols = new Map();
  const owners = new Set();
  const nodes = new Set();
  const hookPreludes = [];
  if (!names.size) return { nodes, bindings: [] };
  function readImports(node) {
    if (ts.isImportSpecifier(node)) {
      const binding = names.get(node.name.text);
      if (binding)
        symbols.set(symbolOf(checker, node.name), {
          ...binding,
          declaration: node.name,
          used: false,
        });
    }
    ts.forEachChild(node, readImports);
  }
  readImports(tree);
  if (symbols.has(undefined) || symbols.size !== names.size)
    reject(`Unbound functional Web capability: ${path}`);

  function inspectUse(node) {
    const binding = symbols.get(symbolOf(checker, node));
    if (!binding || node === binding.declaration) return;
    const owner = renderOwner(node);
    if (!owner || binding.used)
      reject(`Unreviewed functional Web capability use: ${path}#${node.text}`);
    if (binding.kind === "capability-hook") {
      const statement = directHookStatement(node, owner);
      if (!statement) reject(`Unreviewed functional Web capability use: ${path}#${node.text}`);
      hookPreludes.push(priorStatements(statement, owner.body));
    } else if (!directComponentRender(node, owner)) {
      reject(`Unreviewed functional Web capability use: ${path}#${node.text}`);
    }
    binding.used = true;
    nodes.add(node.parent);
    owners.add(symbolOf(checker, owner.name));
  }
  function visit(node) {
    if (ts.isIdentifier(node)) inspectUse(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (
    hookPreludes.some(
      (statements) => !statements.every((statement) => inertHookPrelude(statement, nodes)),
    )
  )
    reject(`Unreviewed effect before a functional Web capability hook: ${path}`);

  function checkOwners(node) {
    if (
      ts.isIdentifier(node) &&
      owners.has(symbolOf(checker, node)) &&
      !(ts.isFunctionDeclaration(node.parent) && node.parent.name === node)
    )
      reject(`Capability-bearing presentation owner must be a terminal mount: ${path}`);
    ts.forEachChild(node, checkOwners);
  }
  checkOwners(tree);
  if ([...symbols.values()].some((binding) => !binding.used))
    reject(`Imported functional Web capability has no reviewed use: ${path}`);
  return {
    nodes,
    bindings: [...symbols.values()].map((binding) => ({
      consumer: path,
      provider: binding.path,
      export: binding.name,
      kind: binding.kind === "capability-hook" ? "hook" : "component",
    })),
  };
}

export function verifyCapabilityBoundary(edges, contracts, modules, mounts, bindings, reject) {
  const consumers = new Set(bindings.map((row) => row.consumer));
  const uses = new Set(bindings.map((row) => `${row.consumer}\0${row.provider}`));
  for (const [from, targets] of edges) {
    if (!mounts.has(from) && targets.some((target) => consumers.has(target)))
      reject(`Capability consumer requires an exact immutable mount: ${from}`);
    // Protected code may keep using its own frozen providers. Only edges
    // crossing from a mutable island or back into it need this grant.
    if (
      modules.has(from) &&
      targets.some((target) => contracts.has(target) && !uses.has(`${from}\0${target}`))
    )
      reject(`Functional Web capability edge lacks a checked named import: ${from}`);
  }
}

export function capabilityBindingsHash(contracts, files, bindings) {
  const providers = [...contracts.values()].map(({ path, exports }) => ({
    path,
    blob: files.get(path).blob,
    exports,
  }));
  const key = (row) => `${row.consumer}\0${row.provider}\0${row.export}`;
  const rows = bindings.toSorted((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return createHash("sha256")
    .update(canonical({ providers, bindings: rows }))
    .digest("hex");
}
