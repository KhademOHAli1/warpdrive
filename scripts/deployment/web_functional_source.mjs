/**
 * Source-only admission for an existing, reviewed presentation island. The
 * caller must authenticate the revisions and pin the profile independently.
 * Initial adapter extraction, installed SDK identity and release qualification
 * belong to separate gates.
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, posix } from "node:path";
import postcss from "postcss";
import ts from "typescript";
import { selectBuildEntries } from "../build-workers.mjs";
import { canonical } from "./component_inputs.mjs";
import { guardWebInputs, WEB_INPUT_POLICY } from "./web_inputs.mjs";
import {
  createWebGitSourceReader,
  lockedWebPackages,
  readWebGitTree,
  runWebGit,
} from "./web_presentation_policy.mjs";

const VERSION = 1;
const REVISION = /^[a-f0-9]{40}$/u;
const ISLAND_PREFIX =
  /^src\/(?:components\/|features\/[a-z0-9_-]+\/ui\/)(?:[a-z0-9_-]+\/)*[a-z0-9_-]+/iu;
const SCRIPT = /\.[cm]?[jt]sx?$/u;
const STYLE = /\.module\.css$/u;
const EXCLUDED_LEAF =
  /(?:^|\/)(?:index|route|actions?|server|middleware|proxy|instrumentation|[^/]+\.(?:test|spec|stories|d))\.[cm]?[jt]sx?$/iu;
const PROTECTED_ENTRY =
  /^(?:src\/(?:server|db|config|jobs|entrypoints|trpc|pages)\/|src\/features\/[^/]+\/(?:server|actions|routers|jobs)\/|(?:src\/)?(?:middleware|proxy|instrumentation(?:-client)?)\.|src\/app\/(?:.*\/)?(?:route|robots|sitemap|manifest|icon\d*|apple-icon\d*|opengraph-image\d*|twitter-image\d*)\.)/u;
const UI_PATH = /^src\/(?:app|components|features)\/[a-z0-9_./()@[\]-]+\.tsx?$/iu;
const EXTENSIONS = WEB_INPUT_POLICY.localResolution.candidateExtensions;
const MAX_ISLAND_FILES = 64;
const MAX_ISLAND_BYTES = 512 * 1024;
const MAX_GRAPH_BYTES = 32 * 1024 * 1024;

const REACT_IMPORTS = new Set([
  "Fragment",
  "KeyboardEvent",
  "MouseEvent",
  "ReactNode",
  "RefObject",
  "useId",
  "useRef",
  "useState",
]);
const REACT_HOOKS = new Set(["useId", "useRef", "useState"]);
const SDK_IMPORTS = new Map([
  [
    "@ui-sdk/react/menu",
    new Set(["Menu", "MenuContent", "MenuItem", "MenuSeparator", "MenuTrigger"]),
  ],
  [
    "@ui-sdk/react/dialog",
    new Set([
      "Dialog",
      "DialogClose",
      "DialogContent",
      "DialogDescription",
      "DialogTitle",
      "DialogTrigger",
    ]),
  ],
  [
    "@ui-sdk/react/drawer",
    new Set([
      "Drawer",
      "DrawerClose",
      "DrawerContent",
      "DrawerDescription",
      "DrawerTitle",
      "DrawerTrigger",
    ]),
  ],
]);
const DOM_TAGS = new Set([
  "article",
  "aside",
  "button",
  "div",
  "footer",
  "h1",
  "h2",
  "h3",
  "header",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "section",
  "small",
  "span",
  "strong",
  "ul",
]);
const EVENTS = new Set([
  "onBlur",
  "onClick",
  "onFocus",
  "onKeyDown",
  "onKeyUp",
  "onOpenChange",
  "onSelect",
]);
const ATTRIBUTES = new Set([
  "className",
  "defaultOpen",
  "disabled",
  "hidden",
  "id",
  "key",
  "open",
  "ref",
  "role",
  "tabIndex",
  "title",
  "type",
]);
const SAFE_PROPERTIES = new Set([
  "altKey",
  "checked",
  "ctrlKey",
  "current",
  "defaultPrevented",
  "id",
  "key",
  "label",
  "length",
  "metaKey",
  "repeat",
  "shiftKey",
  "title",
  "value",
]);
const SAFE_OPERATORS = new Set([
  "!",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  "<=",
  ">",
  ">=",
  "===",
  "!==",
  "&&",
  "||",
  "??",
]);
const SIMPLE_NODES = new Set([
  ts.SyntaxKind.ArrayBindingPattern,
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.BindingElement,
  ts.SyntaxKind.Block,
  ts.SyntaxKind.BreakStatement,
  ts.SyntaxKind.CaseBlock,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ContinueStatement,
  ts.SyntaxKind.DefaultClause,
  ts.SyntaxKind.DefaultKeyword,
  ts.SyntaxKind.EmptyStatement,
  ts.SyntaxKind.EndOfFileToken,
  ts.SyntaxKind.EqualsGreaterThanToken,
  ts.SyntaxKind.ExportKeyword,
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.JsxAttributes,
  ts.SyntaxKind.JsxElement,
  ts.SyntaxKind.JsxExpression,
  ts.SyntaxKind.JsxFragment,
  ts.SyntaxKind.JsxOpeningFragment,
  ts.SyntaxKind.JsxClosingFragment,
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.ObjectBindingPattern,
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.QuestionDotToken,
  ts.SyntaxKind.QuestionToken,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.SourceFile,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.VariableDeclarationList,
  ts.SyntaxKind.VariableStatement,
]);
const STYLE_PROPERTIES = new Set([
  "align-items",
  "background-color",
  "border",
  "border-color",
  "border-radius",
  "box-shadow",
  "color",
  "column-gap",
  "display",
  "flex",
  "flex-direction",
  "flex-wrap",
  "font-size",
  "font-weight",
  "gap",
  "grid-template-columns",
  "height",
  "justify-content",
  "line-height",
  "margin",
  "margin-block",
  "margin-inline",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "opacity",
  "outline",
  "outline-offset",
  "overflow",
  "padding",
  "padding-block",
  "padding-inline",
  "row-gap",
  "text-align",
  "text-overflow",
  "transform",
  "transition",
  "white-space",
  "width",
]);
const STYLE_FUNCTIONS = new Set([
  "calc",
  "clamp",
  "max",
  "min",
  "rgb",
  "rgba",
  "scale",
  "translate",
  "var",
]);
const hash = (value) => createHash("sha256").update(canonical(value)).digest("hex");

export class WebFunctionalSourceError extends Error {}

function reject(message) {
  throw new WebFunctionalSourceError(message);
}

function reviewedPathList(list, matches, kind) {
  if (
    !Array.isArray(list) ||
    list.length > MAX_ISLAND_FILES ||
    new Set(list).size !== list.length ||
    list.some(
      (path) =>
        typeof path !== "string" ||
        path.length > 240 ||
        path.split("/").some((part) => part === "." || part === "..") ||
        !matches(path),
    )
  )
    reject(`Invalid exact ${kind} paths`);
  return [...list].sort();
}

function readProfile(profile) {
  if (
    !profile ||
    Object.getPrototypeOf(profile) !== Object.prototype ||
    Object.keys(profile).sort().join(",") !== "adapters,modules,styles,version" ||
    profile.version !== VERSION
  )
    reject("Unsupported functional Web profile");
  const modules = reviewedPathList(
    profile.modules,
    (path) => ISLAND_PREFIX.test(path) && UI_PATH.test(path) && !EXCLUDED_LEAF.test(path),
    "module",
  );
  const styles = reviewedPathList(
    profile.styles,
    (path) => ISLAND_PREFIX.test(path) && /^[a-z0-9_./-]+$/iu.test(path) && STYLE.test(path),
    "style",
  );
  const adapters = reviewedPathList(
    profile.adapters,
    (path) => UI_PATH.test(path) && !PROTECTED_ENTRY.test(path) && !EXCLUDED_LEAF.test(path),
    "adapter",
  );
  if (
    !modules.length ||
    !adapters.length ||
    new Set([...modules, ...styles, ...adapters]).size !==
      modules.length + styles.length + adapters.length
  )
    reject("Functional Web profile requires disjoint island modules, styles and adapters");
  return { version: VERSION, modules, styles, adapters };
}

function verifyIslandFiles(before, after, island, adapters) {
  let islandBytes = 0;
  for (const path of [...island, ...adapters]) {
    if (before.get(path)?.mode !== "100644")
      reject(`Reviewed path is missing or executable: ${path}`);
    if (island.has(path)) islandBytes += before.get(path).bytes + (after.get(path)?.bytes ?? 0);
  }
  if (islandBytes > MAX_ISLAND_BYTES) reject("Functional Web island exceeded its byte budget");
}

function inspectDelta(before, after, island) {
  if (before.size !== after.size) reject("Git source membership changed");
  const changed = [];
  const protectedSource = [];
  for (const [path, old] of before) {
    const current = after.get(path);
    if (!current || current.mode !== old.mode)
      reject(`Protected source membership or mode changed: ${path}`);
    if (island.has(path)) {
      if (old.blob !== current.blob)
        changed.push({ path, baselineBlob: old.blob, currentBlob: current.blob });
    } else {
      if (old.blob !== current.blob) reject(`Protected source bytes changed: ${path}`);
      protectedSource.push(old);
    }
  }
  if (!changed.length) reject("At least one reviewed functional module or stylesheet must change");
  return { changed, protectedSource };
}

function scriptTree(path, source) {
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  if (tree.parseDiagnostics.length) reject(`Unparseable first-party source: ${path}`);
  return tree;
}

function moduleSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
    return node.argument.literal;
  if (ts.isExternalModuleReference(node)) return node.expression;
  if (ts.isJSDocImportTag(node)) return node.moduleSpecifier;
  return undefined;
}

function isModuleCall(node) {
  return (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))
  );
}

function isLiteral(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
}

function directReference(specifier, from, files) {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return [];
  const base = specifier.startsWith("@/")
    ? posix.normalize(`src/${specifier.slice(2)}`)
    : posix.normalize(posix.join(posix.dirname(from), specifier));
  const explicit = { ".js": [".ts", ".tsx"], ".mjs": [".mts"], ".cjs": [".cts"], ".jsx": [".tsx"] };
  const extension = posix.extname(base);
  const substituted = (explicit[extension] ?? []).map(
    (suffix) => base.slice(0, -extension.length) + suffix,
  );
  return [
    base,
    ...substituted,
    ...EXTENSIONS.map((suffix) => base + suffix),
    ...EXTENSIONS.map((suffix) => `${base}/index${suffix}`),
  ].filter((path) => files.has(path));
}

function isSdkSpecifier(value) {
  try {
    return /(?:^|\/)@ui-sdk\//iu.test(decodeURIComponent(value).replaceAll("\\", "/"));
  } catch {
    return /@ui-sdk/iu.test(value);
  }
}

function addReference(context, node, specifier) {
  const { graph, path, files, modules, adapters } = context;
  if (isSdkSpecifier(specifier)) {
    if (!modules.has(path))
      reject(`Web SDK import outside the reviewed presentation island: ${path}`);
    graph.usesSdk = true;
  }
  const paths = directReference(specifier, path, files);
  context.edges.push(...paths);
  if (
    adapters.has(path) &&
    paths.some((target) => modules.has(target) || context.styles.has(target))
  )
    context.adapterImports.push({ node, paths });
}

function scanScript(tree, graph, path, files, reviewed) {
  const runtimeSource =
    /^(?:src\/|next\.config\.)/u.test(path) &&
    !/\.(?:test|spec|stories|d)\.[cm]?[jt]sx?$/u.test(path);
  const context = { tree, graph, path, files, ...reviewed, edges: [], adapterImports: [] };
  function visit(node) {
    for (const comment of node.jsDoc ?? []) visit(comment);
    if (context.modules.has(path) && ts.isImportTypeNode(node))
      reject(`Unreviewed presentation type loader: ${path}`);
    let value = moduleSpecifier(node);
    if (isModuleCall(node)) {
      value = node.arguments[0];
      if (runtimeSource && (!isLiteral(value) || node.arguments.length !== 1))
        reject(`Opaque first-party runtime module loader: ${path}`);
    }
    if (isLiteral(value)) addReference(context, node, value.text);
    if (
      ts.isExpressionStatement(node) &&
      ts.isStringLiteral(node.expression) &&
      node.expression.text === "use server"
    )
      graph.protectedRoots.add(path);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const reference of tree.referencedFiles) {
    const path = reference.fileName.startsWith(".")
      ? reference.fileName
      : `./${reference.fileName}`;
    addReference(context, undefined, path);
  }
  graph.edges.set(path, [...new Set(context.edges)].sort());
  if (context.adapters.has(path)) verifyAdapter(context);
}

function cssTree(path, source) {
  try {
    return postcss.parse(source, { from: path });
  } catch {
    reject(`Unparseable first-party stylesheet: ${path}`);
  }
}

function scanStyle(tree, graph, path, files) {
  const edges = [];
  tree.walkAtRules(/^(?:import|reference|config|plugin)$/iu, (rule) => {
    const match = /^(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s)]+))/iu.exec(rule.params);
    if (match) {
      const target = match[1] ?? match[2] ?? match[3];
      if (isSdkSpecifier(target))
        reject(`Web SDK stylesheet import is outside the reviewed API: ${path}`);
      edges.push(...directReference(target, path, files));
    }
  });
  graph.edges.set(path, [...new Set(edges)].sort());
}

function verifyStyle(tree, path) {
  tree.walk((node) => {
    if (node.type === "comment") return;
    if (
      node.type === "rule" &&
      /^\.[a-zA-Z][a-zA-Z0-9_-]*(?::(?:focus-visible|focus-within|focus|hover|active|disabled))?$/u.test(
        node.selector,
      ) &&
      node.parent?.type === "root"
    )
      return;
    if (
      node.type === "decl" &&
      node.parent?.type === "rule" &&
      STYLE_PROPERTIES.has(node.prop) &&
      !node.important &&
      /^[a-zA-Z0-9_#(),.%+*/ -]+$/u.test(node.value) &&
      [...node.value.matchAll(/([a-zA-Z_-]+)\s*\(/gu)].every((match) =>
        STYLE_FUNCTIONS.has(match[1]),
      )
    )
      return;
    reject(`Unreviewed functional stylesheet syntax: ${path}`);
  });
}

function descendants(edges, roots) {
  const found = new Set();
  const pending = [...roots];
  while (pending.length) {
    const path = pending.pop();
    if (found.has(path)) continue;
    found.add(path);
    pending.push(...(edges.get(path) ?? []));
  }
  return found;
}

function verifyBoundary(graph, island, adapters) {
  for (const [from, edges] of graph.edges) {
    if (!island.has(from) && !adapters.has(from) && edges.some((to) => island.has(to)))
      reject(`Unreviewed ingress into the functional Web island: ${from}`);
    if (island.has(from) && edges.some((to) => !island.has(to)))
      reject(`Functional Web island reaches protected application source: ${from}`);
  }
  for (const path of descendants(graph.edges, graph.protectedRoots)) {
    if (island.has(path) || adapters.has(path))
      reject(
        `Protected server, route or runtime closure reaches the functional Web island: ${path}`,
      );
  }
  const reachable = descendants(graph.edges, adapters);
  if ([...island].some((path) => !reachable.has(path)))
    reject("Reviewed island file has no exact immutable adapter path");
}

function inspectStyleImport(node, path, names) {
  const clause = node.importClause;
  if (!clause?.name || clause.namedBindings || clause.isTypeOnly || node.attributes)
    reject(`Only named CSS-module objects are admitted: ${path}`);
  names.set(clause.name.text, { kind: "style" });
}

function inspectNamedImport(node, path, names, kind, allowed) {
  const clause = node.importClause;
  const bindings = clause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings) || clause.name || node.attributes)
    reject(`Unreviewed presentation import in ${path}`);
  for (const element of bindings.elements) {
    const name = (element.propertyName ?? element.name).text;
    if (allowed && !allowed.has(name)) reject(`Unreviewed presentation import binding in ${path}`);
    names.set(element.name.text, {
      kind: clause.isTypeOnly || element.isTypeOnly ? "type" : kind,
      name,
    });
  }
}

function inspectImport(node, path, names, files, modules, styles) {
  const source = node.moduleSpecifier.text;
  const paths = directReference(source, path, files);
  const exact = paths.length === 1 ? paths[0] : undefined;
  if (styles.has(exact)) {
    inspectStyleImport(node, path, names);
  } else if (modules.has(exact)) {
    inspectNamedImport(node, path, names, "local");
  } else {
    const allowed = source === "react" ? REACT_IMPORTS : SDK_IMPORTS.get(source);
    if (!allowed) reject(`Unreviewed presentation import in ${path}`);
    inspectNamedImport(node, path, names, source === "react" ? "react" : "sdk", allowed);
  }
}

function inspectImports(tree, path, files, modules, styles) {
  const names = new Map();
  for (const node of tree.statements) {
    if (ts.isImportDeclaration(node)) inspectImport(node, path, names, files, modules, styles);
  }
  return names;
}

function checkerFor(tree) {
  const options = { noLib: true, noResolve: true, jsx: ts.JsxEmit.Preserve, types: [] };
  const program = ts.createProgram([tree.fileName], options, {
    getSourceFile: (name) => (name === tree.fileName ? tree : undefined),
    getDefaultLibFileName: () => "",
    writeFile: () => reject("Functional source check attempted a write"),
    getCurrentDirectory: () => "",
    getCanonicalFileName: (name) => name,
    getNewLine: () => "\n",
    useCaseSensitiveFileNames: () => true,
    fileExists: (name) => name === tree.fileName,
    readFile: (name) => (name === tree.fileName ? tree.text : undefined),
  });
  return program.getTypeChecker();
}

function adapterBindings(context, checker) {
  const bindings = new Map();
  for (const { node, paths } of context.adapterImports) {
    if (
      !node ||
      !ts.isImportDeclaration(node) ||
      paths.length !== 1 ||
      !context.modules.has(paths[0])
    )
      reject(`Adapter may import only exact render components from the island: ${context.path}`);
    const clause = node.importClause;
    const named = clause?.namedBindings;
    if (
      !named ||
      !ts.isNamedImports(named) ||
      clause.isTypeOnly ||
      clause.name ||
      node.attributes ||
      !named.elements.length
    )
      reject(`Adapter requires named island render imports: ${context.path}`);
    for (const binding of named.elements) {
      const symbol = checker.getSymbolAtLocation(binding.name);
      if (!symbol || binding.isTypeOnly)
        reject(`Adapter requires runtime island render imports: ${context.path}`);
      bindings.set(symbol, binding.name);
    }
  }
  return bindings;
}

function renderTag(node) {
  const parent = node.parent;
  return (
    (ts.isJsxOpeningElement(parent) ||
      ts.isJsxSelfClosingElement(parent) ||
      ts.isJsxClosingElement(parent)) &&
    parent.tagName === node
  );
}

function verifyAdapter(context) {
  const checker = checkerFor(context.tree);
  const bindings = adapterBindings(context, checker);
  const used = new Set();
  function visit(node) {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const declaration = bindings.get(symbol);
      if (declaration && node !== declaration) {
        if (!renderTag(node))
          reject(`Adapter may only render an island component as JSX: ${context.path}`);
        used.add(symbol);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(context.tree);
  if (!bindings.size || used.size !== bindings.size)
    reject(`Adapter must directly render each imported island component: ${context.path}`);
}

function isCallableDeclaration(node) {
  return Boolean(
    node &&
      (ts.isFunctionDeclaration(node) ||
        (ts.isVariableDeclaration(node) &&
          node.initializer &&
          ts.isArrowFunction(node.initializer))),
  );
}

function importedBinding(context, node) {
  const declaration = context.checker.getSymbolAtLocation(node)?.declarations?.[0];
  if (declaration && (ts.isImportSpecifier(declaration) || ts.isImportClause(declaration)))
    return context.imports.get(node.text);
  return undefined;
}

function checkedHook(context, node, name) {
  if (!node || !ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return false;
  const binding = importedBinding(context, node.expression);
  return binding?.kind === "react" && binding.name === name;
}

function stateSetter(context, node) {
  const declaration = context.checker.getSymbolAtLocation(node)?.declarations?.[0];
  if (
    !declaration ||
    !ts.isBindingElement(declaration) ||
    !ts.isArrayBindingPattern(declaration.parent)
  )
    return false;
  const array = declaration.parent;
  return (
    array.elements[1] === declaration &&
    ts.isVariableDeclaration(array.parent) &&
    checkedHook(context, array.parent.initializer, "useState")
  );
}

function refBinding(context, node) {
  if (!ts.isIdentifier(node)) return false;
  const declaration = context.checker.getSymbolAtLocation(node)?.declarations?.[0];
  return (
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    checkedHook(context, declaration.initializer, "useRef")
  );
}

function dataExpression(node) {
  if (!node) return false;
  return (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
      node.kind,
    )
  );
}

function eventMember(context, expression, member) {
  if (["focus", "blur"].includes(member))
    return (
      ts.isPropertyAccessExpression(expression) &&
      expression.name.text === "current" &&
      refBinding(context, expression.expression)
    );
  if (!["preventDefault", "stopPropagation"].includes(member) || !ts.isIdentifier(expression))
    return false;
  const declaration = context.checker.getSymbolAtLocation(expression)?.declarations?.[0];
  return (
    declaration && ts.isParameter(declaration) && context.eventHandlers.has(declaration.parent)
  );
}

function hookArguments(binding, args) {
  if (binding?.kind !== "react" || !REACT_HOOKS.has(binding.name)) return false;
  if (binding.name === "useId") return args.length === 0;
  if (args.length !== 1) return false;
  if (binding.name === "useRef") return args[0].kind === ts.SyntaxKind.NullKeyword;
  return dataExpression(args[0]);
}

function localStateUpdate(context, target, args) {
  if (!stateSetter(context, target) || args.length !== 1) return false;
  const [value] = args;
  return dataExpression(value) || ts.isArrowFunction(value) || ts.isPrefixUnaryExpression(value);
}

function verifyCall(context, node) {
  const target = node.expression;
  if (
    ts.isPropertyAccessExpression(target) &&
    node.arguments.length === 0 &&
    eventMember(context, target.expression, target.name.text)
  )
    return;
  if (!ts.isIdentifier(target)) reject(`Indirect or unreviewed presentation call: ${context.path}`);
  const binding = importedBinding(context, target);
  if (
    binding?.kind === "local" ||
    isCallableDeclaration(context.checker.getSymbolAtLocation(target)?.declarations?.[0]) ||
    localStateUpdate(context, target, node.arguments) ||
    hookArguments(binding, node.arguments)
  )
    return;
  reject(`Unreviewed presentation call: ${context.path}`);
}

function namedComponent(context, tag) {
  if (!ts.isIdentifier(tag)) return false;
  const binding = importedBinding(context, tag);
  return (
    binding?.kind === "sdk" ||
    binding?.kind === "local" ||
    (binding?.kind === "react" && binding.name === "Fragment") ||
    isCallableDeclaration(context.checker.getSymbolAtLocation(tag)?.declarations?.[0])
  );
}

function jsxExpression(node) {
  return node.initializer && ts.isJsxExpression(node.initializer)
    ? node.initializer.expression
    : undefined;
}

function classExpression(context, node) {
  return (
    node &&
    ((ts.isStringLiteral(node) && /^[a-zA-Z0-9_:\s-]*$/u.test(node.text)) ||
      (ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        importedBinding(context, node.expression)?.kind === "style") ||
      (ts.isConditionalExpression(node) &&
        classExpression(context, node.whenTrue) &&
        classExpression(context, node.whenFalse)))
  );
}

function validButtonType(value) {
  return value && ts.isStringLiteral(value) && value.text === "button";
}

function verifyAttribute(context, name, initializer, expression, native) {
  if (EVENTS.has(name)) {
    if (
      expression &&
      (ts.isArrowFunction(expression) ||
        (ts.isIdentifier(expression) && stateSetter(context, expression)))
    )
      return;
    reject(`Presentation event callback must be inline or a local state setter: ${context.path}`);
  }
  if (name === "ref" && (!native || !expression || !refBinding(context, expression)))
    reject(`Presentation ref must be locally owned: ${context.path}`);
  if (name === "className" && !classExpression(context, expression ?? initializer))
    reject(`Unreviewed presentation class expression: ${context.path}`);
  if (name === "type" && !validButtonType(initializer))
    reject(`Presentation button requires explicit non-submit type: ${context.path}`);
  if (!ATTRIBUTES.has(name) && !/^(?:aria|data)-[a-z0-9-]+$/u.test(name))
    reject(`Unreviewed presentation attribute: ${context.path}`);
}

function verifyElement(context, node) {
  const { tagName, attributes } = node;
  const native = ts.isIdentifier(tagName) && DOM_TAGS.has(tagName.text);
  if (!native && !namedComponent(context, tagName))
    reject(`Unreviewed presentation element: ${context.path}`);
  const names = new Set();
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name))
      reject(`Spread or nonliteral presentation attributes: ${context.path}`);
    const name = attribute.name.text;
    if (names.has(name)) reject(`Duplicate presentation attribute: ${context.path}`);
    names.add(name);
    const expression = jsxExpression(attribute);
    verifyAttribute(context, name, attribute.initializer, expression, native);
    if (expression) verifyNode(context, expression);
  }
  if (native && tagName.text === "button" && !names.has("type"))
    reject(`Presentation button requires explicit non-submit type: ${context.path}`);
}

function localIdentifier(context, node) {
  if (node.text === "undefined") return;
  const symbol = context.checker.getSymbolAtLocation(node);
  if (!symbol?.declarations?.some((declaration) => declaration.getSourceFile() === context.tree))
    reject(`Ambient or unbound presentation identifier: ${context.path}`);
  if (importedBinding(context, node)?.kind === "type")
    reject(`Type-only presentation value: ${context.path}`);
}

function verifyProperty(context, node) {
  if (
    ts.isIdentifier(node.expression) &&
    importedBinding(context, node.expression)?.kind === "style" &&
    /^[a-zA-Z][a-zA-Z0-9_-]*$/u.test(node.name.text) &&
    !["constructor", "prototype", "__proto__"].includes(node.name.text)
  )
    return;
  if (SAFE_PROPERTIES.has(node.name.text)) return;
  if (
    ts.isCallExpression(node.parent) &&
    node.parent.expression === node &&
    eventMember(context, node.expression, node.name.text)
  )
    return;
  reject(`Unreviewed presentation property: ${context.path}`);
}

function verifyNode(context, node) {
  if (
    ts.isImportDeclaration(node) ||
    ts.isTypeNode(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isJsxClosingElement(node)
  )
    return;
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    verifyElement(context, node);
    return;
  }
  if (ts.isIdentifier(node)) {
    localIdentifier(context, node);
  } else if (ts.isPropertyAccessExpression(node)) {
    verifyProperty(context, node);
    verifyNode(context, node.expression);
    return;
  } else if (ts.isCallExpression(node)) {
    verifyCall(context, node);
  } else if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.getText(context.tree);
    if (!SAFE_OPERATORS.has(operator)) reject(`Unreviewed presentation operator: ${context.path}`);
    verifyNode(context, node.left);
    verifyNode(context, node.right);
    return;
  } else if (ts.isPrefixUnaryExpression(node)) {
    if (
      ![ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(
        node.operator,
      )
    )
      reject(`Unreviewed presentation operator: ${context.path}`);
  } else if (!SIMPLE_NODES.has(node.kind)) {
    reject(`Unreviewed presentation syntax (${ts.SyntaxKind[node.kind]}): ${context.path}`);
  }
  if (
    ts.isExpressionStatement(node) &&
    ts.isStringLiteral(node.expression) &&
    node.expression.text !== "use client"
  )
    reject(`Unreviewed presentation directive: ${context.path}`);
  ts.forEachChild(node, (child) => verifyNode(context, child));
}

function inspectIslandScript(tree, path, files, modules, styles) {
  const first = tree.statements[0];
  if (
    !first ||
    !ts.isExpressionStatement(first) ||
    !ts.isStringLiteral(first.expression) ||
    first.expression.text !== "use client"
  )
    reject(`Reviewed presentation module requires an explicit client directive: ${path}`);
  if (
    /@(?:ts-|jsx|jest)|\\|(?:[a-zA-Z0-9_-]+[-:]\[|\[[^\]\n]*:)/u.test(tree.text) ||
    tree.referencedFiles.length ||
    tree.typeReferenceDirectives.length ||
    tree.libReferenceDirectives.length
  )
    reject(`Unreviewed presentation compiler directive: ${path}`);
  const imports = inspectImports(tree, path, files, modules, styles);
  const checker = checkerFor(tree);
  const eventHandlers = new Set();
  function findHandlers(node) {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && EVENTS.has(node.name.text)) {
      const expression = jsxExpression(node);
      if (expression && ts.isArrowFunction(expression)) eventHandlers.add(expression);
    }
    ts.forEachChild(node, findHandlers);
  }
  findHandlers(tree);
  verifyNode({ path, tree, imports, checker, eventHandlers }, tree);
}

function exactDependencies(read) {
  try {
    const manifest = JSON.parse(read("package.json"));
    const parsed = ts.parseConfigFileTextToJson("bun.lock", read("bun.lock"));
    if (parsed.error) reject("Invalid exact Web dependency lock");
    return { manifest, lock: parsed.config, packages: lockedWebPackages(manifest, parsed.config) };
  } catch {
    reject("Invalid exact Web dependency inputs");
  }
}

const SDK_VERSION = "0.1.0-beta.1";
const SDK_INTEGRITIES = new Map([
  [
    "@ui-sdk/core",
    "sha512-sWsZW8RN6Gviir7REQYuDIafm9hierHQE31OJ+2g+1Pp3lDVKp/dk0+0dxFvqOQRmBveRvlE9FiARgNlQ9dMFw==",
  ],
  [
    "@ui-sdk/react",
    "sha512-7wcUsZI+WoG2uo3N+PHrWntk97qI9ez2cUrHV9H507FiL118Pi4tuhWUCMDtWwEUCNQLybpBm1QRLkEXVOPAUg==",
  ],
]);

function verifySdkSource(root, files, read) {
  const entry = files.get("tools/web-ui/bun.lock");
  if (entry?.mode !== "100644" || entry.bytes > 64 * 1024)
    reject("Reviewed Web SDK lock is required in the original source");
  const raw = runWebGit(root, ["cat-file", "blob", entry.blob], { maxBuffer: 64 * 1024 });
  const parsed = ts.parseConfigFileTextToJson("bun.lock", raw.toString("utf8"));
  const sidecar = JSON.parse(read("tools/web-ui/package.json"));
  if (
    raw.length !== entry.bytes ||
    parsed.error ||
    sidecar.private !== true ||
    sidecar.name !== "warpdrive-web-ui" ||
    sidecar.packageManager !== "bun@1.4.4"
  )
    reject("Invalid reviewed Web SDK sidecar source");
  for (const [name, integrity] of SDK_INTEGRITIES) {
    const row = parsed.config?.packages?.[name];
    if (
      sidecar.dependencies?.[name] !== SDK_VERSION ||
      !Array.isArray(row) ||
      row[0] !== `${name}@${SDK_VERSION}` ||
      row[3] !== integrity
    )
      reject("Unreviewed Web SDK version or integrity");
  }
}

function scanFile(path, source, graph, files, reviewed) {
  const { modules, styles } = reviewed;
  if (SCRIPT.test(path)) {
    const tree = scriptTree(path, source);
    scanScript(tree, graph, path, files, reviewed);
    if (modules.has(path)) inspectIslandScript(tree, path, files, modules, styles);
  } else {
    const tree = cssTree(path, source);
    scanStyle(tree, graph, path, files);
    if (styles.has(path)) verifyStyle(tree, path);
  }
}

function scanFirstParty(files, read, reviewed) {
  const graph = {
    edges: new Map(),
    protectedRoots: new Set(selectBuildEntries("all").map((entry) => entry.in)),
    usesSdk: false,
  };
  let bytes = 0;
  for (const [path, entry] of files) {
    if (!SCRIPT.test(path) && !path.endsWith(".css")) continue;
    bytes += entry.bytes;
    if (bytes > MAX_GRAPH_BYTES) reject("Functional Web graph exceeded source budget");
    if (PROTECTED_ENTRY.test(path)) graph.protectedRoots.add(path);
    scanFile(path, read(path), graph, files, reviewed);
  }
  return graph;
}

async function inspectSnapshot(root, files, { modules, styles, island, adapters }) {
  const read = createWebGitSourceReader(root, files);
  const graph = scanFirstParty(files, read, { modules, styles, adapters });
  verifyBoundary(graph, island, adapters);
  const { manifest, lock, packages } = exactDependencies(read);
  if (graph.usesSdk) {
    verifySdkSource(root, files, read);
    packages["@ui-sdk/react"] = true;
  }
  const reachable = new Set(
    await guardWebInputs({
      root,
      files: [...files.keys()],
      read,
      helperEntries: selectBuildEntries("web"),
      manifest,
      lock,
      production: packages,
      fail: reject,
    }),
  );
  if ([...adapters, ...island].some((path) => !reachable.has(path)))
    reject("Functional Web island and adapters must be reachable from reviewed Web roots");
  const protectedEdges = [...graph.edges].filter(([path]) => !island.has(path));
  return { protectedEdges, webPathCount: reachable.size };
}

/** Read two exact Git trees without using working files, compiling or deploying. */
export async function verifyWebFunctionalSource({
  root,
  baselineRevision,
  currentRevision,
  profile,
}) {
  if (
    typeof root !== "string" ||
    !isAbsolute(root) ||
    root !== realpathSync(root) ||
    runWebGit(root, ["rev-parse", "--show-prefix"]).toString("ascii") !== "\n" ||
    ![baselineRevision, currentRevision].every(
      (revision) => typeof revision === "string" && REVISION.test(revision),
    ) ||
    baselineRevision === currentRevision
  )
    reject("Canonical Git root and two distinct exact revisions required");
  const reviewed = readProfile(profile);
  runWebGit(root, ["merge-base", "--is-ancestor", baselineRevision, currentRevision]);
  const before = readWebGitTree(root, baselineRevision);
  const after = readWebGitTree(root, currentRevision);
  const modules = new Set(reviewed.modules);
  const styles = new Set(reviewed.styles);
  const island = new Set([...modules, ...styles]);
  const adapters = new Set(reviewed.adapters);
  verifyIslandFiles(before, after, island, adapters);
  const { changed, protectedSource } = inspectDelta(before, after, island);
  const snapshotOptions = { modules, styles, island, adapters };
  const baseline = await inspectSnapshot(root, before, snapshotOptions);
  const current = await inspectSnapshot(root, after, snapshotOptions);
  const protectedGraphSha256 = hash(baseline.protectedEdges);
  if (protectedGraphSha256 !== hash(current.protectedEdges))
    reject("Protected source resolution changed");
  return {
    schemaVersion: VERSION,
    kind: "warpdrive-web-functional-source",
    baselineRevision,
    currentRevision,
    profileSha256: hash(reviewed),
    protectedSourceSha256: hash(protectedSource),
    protectedGraphSha256,
    guardedWebPathCount: current.webPathCount,
    changed,
    deploymentAuthorized: false,
  };
}
