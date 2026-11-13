/** Finite client grammar for structural Web changes. This is a source check. */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, posix } from "node:path";
import postcss from "postcss";
import ts from "typescript";
import { canonical } from "./component_inputs.mjs";
import {
  capabilityImport,
  readStructuralCapabilityProfile,
  verifyCapabilityProvider,
  verifyCapabilityUses,
} from "./web_functional_capabilities.mjs";
import { inspectWebProjectionSnapshot } from "./web_functional_source.mjs";
import { WEB_INPUT_POLICY } from "./web_inputs.mjs";
import { createWebGitSourceReader, readWebGitTree, runWebGit } from "./web_presentation_policy.mjs";

const REVISION = /^[a-f0-9]{40}$/u;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const COMPONENT = /^[A-Z][A-Za-z0-9_]{0,63}$/u;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_NODES = 25_000;
const REACT = new Set(["useState", "useRef", "useId", "Fragment"]);
const SDK = new Map([
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
    "@ui-sdk/react/menu",
    new Set(["Menu", "MenuContent", "MenuItem", "MenuSeparator", "MenuTrigger"]),
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
const TAGS = new Set(
  "article aside button div footer h1 h2 h3 header li main nav ol p section small span strong ul".split(
    " ",
  ),
);
const ATTRIBUTES = new Set(
  "aria-disabled className defaultOpen disabled hidden id key open role tabIndex title type".split(
    " ",
  ),
);
const SDK_BUTTONS = new Set([
  "DialogTrigger",
  "DialogClose",
  "DrawerTrigger",
  "DrawerClose",
  "MenuTrigger",
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
const EVENT_DATA = new Set(["altKey", "ctrlKey", "key", "metaKey", "repeat", "shiftKey"]);
const BINARY = new Set("+ - * / % < <= > >= === !== && || ??".split(" "));
const STYLE_PROPERTY =
  /^(?:align-items|background-color|border(?:-color|-radius)?|box-shadow|color|column-gap|display|flex(?:-direction|-wrap)?|font-(?:size|weight)|gap|grid-template-columns|height|justify-content|line-height|margin(?:-block|-inline)?|max-(?:height|width)|min-(?:height|width)|opacity|outline(?:-offset)?|overflow|padding(?:-block|-inline)?|row-gap|text-align|text-overflow|transform|transition|white-space|width)$/u;
const STYLE_FUNCTION = /^(?:calc|clamp|max|min|rgb|rgba|scale|translate|var)$/u;
const PRIMITIVE_TYPE = new Set([
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.BooleanKeyword,
]);
const LITERAL = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
]);
const COMPOSITE = new Set([
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.Block,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.JsxExpression,
  ts.SyntaxKind.JsxFragment,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.VariableDeclarationList,
]);
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const hash = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const order = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));

export class WebClientEffectProjectionError extends Error {}

function reject(message) {
  throw new WebClientEffectProjectionError(message);
}

function exact(value, keys) {
  return (
    value &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join(",") === keys
  );
}

function reviewedName(value, pattern = NAME) {
  return (
    typeof value === "string" &&
    pattern.test(value) &&
    !["constructor", "prototype", "__proto__"].includes(value)
  );
}

function admitCuts(cuts) {
  if (!Array.isArray(cuts) || !cuts.length || cuts.length > 64)
    reject("Bounded client renderer cuts required");
  const roots = new Map();
  for (const cut of [...cuts]) {
    if (
      !exact(cut, "bindings,from,to") ||
      typeof cut.from !== "string" ||
      typeof cut.to !== "string" ||
      !Array.isArray(cut.bindings) ||
      !cut.bindings.length ||
      cut.bindings.length > 16
    )
      reject("Exact client renderer cut required");
    const exports = roots.get(cut.to) ?? new Set();
    for (const binding of [...cut.bindings]) {
      if (
        !exact(binding, "local,name") ||
        !reviewedName(binding.name, COMPONENT) ||
        !reviewedName(binding.local, COMPONENT)
      )
        reject("Exact named client renderer binding required");
      exports.add(binding.name);
    }
    roots.set(cut.to, exports);
  }
  return roots;
}

function admittedProfile(profile) {
  if (
    !exact(
      profile,
      "afterModules,afterStyles,beforeModules,beforeStyles,capabilities,rendererCuts,version",
    ) ||
    profile.version !== 1
  )
    reject("Exact client effect profile version required");
  const roots = admitCuts(profile.rendererCuts);
  const adapters = [...new Set(profile.rendererCuts.map(({ from }) => from))].sort(order);
  const before = readStructuralCapabilityProfile(
    {
      version: 2,
      modules: profile.beforeModules,
      styles: profile.beforeStyles,
      adapters,
      capabilities: profile.capabilities,
    },
    reject,
  );
  const after = readStructuralCapabilityProfile(
    {
      version: 2,
      modules: profile.afterModules,
      styles: profile.afterStyles,
      adapters,
      capabilities: profile.capabilities,
    },
    reject,
  );
  if (
    [...roots.keys()].some(
      (path) => !before.modules.includes(path) || !after.modules.includes(path),
    ) ||
    before.capabilities.some(({ consumers }) => consumers.some((path) => !roots.has(path)))
  )
    reject("Client effects require an immutable terminal renderer in both inventories");
  return { before, after, roots };
}

function parse(path, source) {
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  if (tree.parseDiagnostics.length) reject(`Unparseable client module: ${path}`);
  return tree;
}

function checkerFor(tree) {
  return ts
    .createProgram(
      [tree.fileName],
      { noLib: true, noResolve: true },
      {
        getSourceFile: (name) => (name === tree.fileName ? tree : undefined),
        getDefaultLibFileName: () => "",
        getCurrentDirectory: () => "",
        getCanonicalFileName: (name) => name,
        getNewLine: () => "\n",
        useCaseSensitiveFileNames: () => true,
        fileExists: (name) => name === tree.fileName,
        readFile: (name) => (name === tree.fileName ? tree.text : undefined),
        writeFile: () => reject("Client effect projection cannot write source"),
      },
    )
    .getTypeChecker();
}

function localTarget(context, specifier) {
  const base = specifier.startsWith("@/")
    ? posix.normalize(`src/${specifier.slice(2)}`)
    : posix.normalize(posix.join(posix.dirname(context.path), specifier));
  const extensions = WEB_INPUT_POLICY.localResolution.candidateExtensions;
  const candidates = [
    base,
    ...extensions.map((suffix) => base + suffix),
    ...extensions.map((suffix) => `${base}/index${suffix}`),
  ];
  const found = candidates.filter((path) => context.files.has(path));
  if (!/^(?:\.{1,2}\/|@\/)[A-Za-z0-9_./()@[\]-]+$/u.test(specifier) || found.length !== 1)
    reject(`Client import requires one exact committed target: ${context.path}`);
  return found[0];
}

function exportedFunction(node) {
  return (
    ts.isFunctionDeclaration(node) &&
    node.body &&
    node.name &&
    !node.asteriskToken &&
    node.modifiers?.length === 1 &&
    node.modifiers[0].kind === ts.SyntaxKind.ExportKeyword
  );
}

function namedImports(context, node, kind, names, target) {
  const clause = node.importClause;
  const named = clause?.namedBindings;
  if (
    !clause ||
    clause.isTypeOnly ||
    clause.name ||
    !named ||
    !ts.isNamedImports(named) ||
    !named.elements.length
  )
    reject(`Client import requires named runtime bindings: ${context.path}`);
  for (const item of named.elements) {
    const name = (item.propertyName ?? item.name).text;
    if (item.isTypeOnly || !names.has(name) || context.imports.has(item.name.text))
      reject(`Unreviewed client import binding: ${context.path}`);
    context.imports.set(item.name.text, { kind, name, path: target });
  }
}

function importBinding(context, node) {
  if (node.attributes || !ts.isStringLiteral(node.moduleSpecifier))
    reject(`Opaque client import: ${context.path}`);
  const specifier = node.moduleSpecifier.text;
  if (specifier === "react" || SDK.has(specifier)) {
    namedImports(
      context,
      node,
      specifier === "react" ? "react" : "sdk",
      SDK.get(specifier) ?? REACT,
      specifier,
    );
    return;
  }
  if (!specifier.startsWith(".") && !specifier.startsWith("@/"))
    reject(`Unreviewed client import authority: ${context.path}`);
  const target = localTarget(context, specifier);
  const contract = context.providers.get(target);
  if (contract) {
    capabilityImport({ node, path: context.path, contract, bindings: context.imports, reject });
    return;
  }
  context.edges.add(target);
  if (context.styles.has(target)) {
    const clause = node.importClause;
    if (
      !clause?.name ||
      clause.isTypeOnly ||
      clause.namedBindings ||
      context.imports.has(clause.name.text)
    )
      reject(`Client stylesheet requires one default binding: ${context.path}`);
    context.imports.set(clause.name.text, { kind: "style", name: clause.name.text, path: target });
    return;
  }
  const local = context.modules.get(target);
  if (!local || context.roots.has(target))
    reject(`Client import crosses the selected subtree: ${context.path}`);
  namedImports(context, node, "local", local.exports, target);
}

function symbol(context, node) {
  return context.checker.getSymbolAtLocation(node)?.declarations?.[0];
}

function imported(context, node) {
  const declaration = symbol(context, node);
  if (declaration && (ts.isImportSpecifier(declaration) || ts.isImportClause(declaration)))
    return context.imports.get(node.text);
  return undefined;
}

function primitive(node) {
  return (
    node &&
    (LITERAL.has(node.kind) ||
      (ts.isPrefixUnaryExpression(node) &&
        node.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(node.operand)))
  );
}

function hookName(context, node) {
  if (!node || !ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return undefined;
  const binding = imported(context, node.expression);
  return binding?.kind === "react" ? binding.name : undefined;
}

function refIdentifier(context, node) {
  const declaration = ts.isIdentifier(node) && symbol(context, node);
  return (
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    hookName(context, declaration.initializer) === "useRef"
  );
}

function setter(context, node) {
  const declaration = symbol(context, node);
  return (
    declaration &&
    ts.isBindingElement(declaration) &&
    ts.isArrayBindingPattern(declaration.parent) &&
    declaration.parent.elements[1] === declaration &&
    ts.isVariableDeclaration(declaration.parent.parent) &&
    hookName(context, declaration.parent.parent.initializer) === "useState"
  );
}

function dataIdentifier(context, node) {
  if (node.text === "undefined") return;
  const declaration = symbol(context, node);
  if (
    !declaration ||
    refIdentifier(context, node) ||
    setter(context, node) ||
    !(
      ts.isVariableDeclaration(declaration) ||
      ts.isBindingElement(declaration) ||
      ts.isParameter(declaration)
    )
  )
    reject(`Unbound or authority-bearing client value: ${context.path}#${node.text}`);
  if (ts.isParameter(declaration) && context.eventParameters.has(declaration))
    reject(`Native event cannot escape its inline handler: ${context.path}`);
}

function eventReceiver(context, node) {
  return ts.isIdentifier(node) && context.eventParameters.has(symbol(context, node));
}

function localMemberCall(context, target) {
  const member = target.name.text;
  const owner = target.expression;
  if (["preventDefault", "stopPropagation"].includes(member)) return eventReceiver(context, owner);
  return (
    ["focus", "blur"].includes(member) &&
    ts.isPropertyAccessExpression(owner) &&
    owner.name.text === "current" &&
    refIdentifier(context, owner.expression)
  );
}

function plainFunction(context, node) {
  const declaration = symbol(context, node);
  return declaration && ts.isFunctionDeclaration(declaration) && declaration.body;
}

function verifyLocalHook(context, node, name) {
  const [first] = node.arguments;
  const declaration = node.parent;
  if (
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer !== node ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    !ts.isVariableStatement(declaration.parent.parent) ||
    !ts.isBlock(declaration.parent.parent.parent) ||
    !ts.isFunctionDeclaration(declaration.parent.parent.parent.parent)
  )
    reject(`Local hooks require a direct function binding: ${context.path}`);
  const valid =
    (name === "useId" && !node.arguments.length) ||
    (name === "useState" && node.arguments.length === 1 && primitive(first)) ||
    (name === "useRef" && node.arguments.length === 1 && first.kind === ts.SyntaxKind.NullKeyword);
  if (!valid) reject(`Unreviewed local React hook: ${context.path}`);
}

function verifyCall(context, node) {
  const target = node.expression;
  if (
    ts.isPropertyAccessExpression(target) &&
    !node.arguments.length &&
    localMemberCall(context, target)
  )
    return;
  if (!ts.isIdentifier(target) || node.questionDotToken)
    reject(`Indirect or unreviewed client call: ${context.path}`);
  const binding = imported(context, target);
  const [first] = node.arguments;
  if (binding?.kind === "react") return verifyLocalHook(context, node, binding.name);
  if (!(binding?.kind === "local" || plainFunction(context, target) || setter(context, target)))
    reject(`Unreviewed client call authority: ${context.path}#${target.text}`);
  if (setter(context, target)) {
    if (node.arguments.length !== 1)
      reject(`Local state update requires one value: ${context.path}`);
    if (ts.isArrowFunction(first)) context.stateUpdaters.add(first);
  }
  for (const argument of node.arguments) verifyNode(context, argument);
}

function attributeExpression(attribute) {
  const value = attribute.initializer;
  return value && ts.isJsxExpression(value) ? value.expression : value;
}

function classValue(context, node) {
  if (!node) return false;
  if (ts.isStringLiteral(node)) return /^[A-Za-z0-9_:\s.-]*$/u.test(node.text);
  if (ts.isConditionalExpression(node))
    return classValue(context, node.whenTrue) && classValue(context, node.whenFalse);
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    imported(context, node.expression)?.kind === "style" &&
    reviewedName(node.name.text)
  );
}

function verifyEventAttribute(context, name, value, native, local, binding) {
  if (
    binding?.kind === "sdk" &&
    !(
      (name === "onOpenChange" && ["Dialog", "Drawer", "Menu"].includes(binding.name)) ||
      (name === "onSelect" && binding.name === "MenuItem")
    )
  )
    reject(`Unreviewed SDK event: ${context.path}`);
  if (!native && !binding?.kind) reject(`Unreviewed client event owner: ${context.path}`);
  if (
    local ||
    !value ||
    (!ts.isArrowFunction(value) && !(ts.isIdentifier(value) && setter(context, value)))
  )
    reject(`Client event requires local inline behavior: ${context.path}`);
  if (ts.isArrowFunction(value)) verifyFunction(context, value, native);
}

function verifyAttribute(context, attribute, native, local, binding) {
  if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name))
    reject(`Opaque client JSX attribute: ${context.path}`);
  const name = attribute.name.text;
  const value = attributeExpression(attribute);
  if (EVENTS.has(name)) {
    verifyEventAttribute(context, name, value, native, local, binding);
    return name;
  }
  if (name === "ref") {
    if (!native || !value || !refIdentifier(context, value))
      reject(`Client ref requires a native owned target: ${context.path}`);
    return name;
  }
  if (name === "type" && (!value || !ts.isStringLiteral(value) || value.text !== "button"))
    reject(`Client button must stay non-submitting: ${context.path}`);
  if (name === "className" && !classValue(context, value))
    reject(`Unreviewed client CSS class: ${context.path}`);
  if (
    !ATTRIBUTES.has(name) &&
    !/^(?:aria|data)-[a-z0-9-]+$/u.test(name) &&
    !(local && reviewedName(name))
  )
    reject(`Unreviewed client JSX attribute: ${context.path}#${name}`);
  if (value) verifyNode(context, value);
  return name;
}

function verifyElement(context, node) {
  const tag = node.tagName;
  if (!ts.isIdentifier(tag)) reject(`Indirect or unreviewed client element: ${context.path}`);
  const native = TAGS.has(tag.text);
  const binding = imported(context, tag);
  const local = binding?.kind === "local" || Boolean(plainFunction(context, tag));
  if (
    !native &&
    (!COMPONENT.test(tag.text) ||
      !(local || binding?.kind === "sdk" || binding?.name === "Fragment"))
  )
    reject(`Unreviewed client element: ${context.path}#${tag.text}`);
  const names = new Set();
  for (const attribute of node.attributes.properties) {
    const name = verifyAttribute(context, attribute, native, local, binding);
    if (names.has(name)) reject(`Duplicate client JSX attribute: ${context.path}`);
    names.add(name);
  }
  if (
    (tag.text === "button" || (binding?.kind === "sdk" && SDK_BUTTONS.has(binding.name))) &&
    !names.has("type")
  )
    reject(`Client button requires explicit type: ${context.path}`);
}

function bindingName(context, node) {
  if (!ts.isIdentifier(node) || !reviewedName(node.text))
    reject(`Unreviewed client binding: ${context.path}`);
}

function scalarType(node) {
  return (
    PRIMITIVE_TYPE.has(node.kind) ||
    (ts.isLiteralTypeNode(node) && primitive(node.literal)) ||
    (ts.isUnionTypeNode(node) && node.types.every(scalarType))
  );
}

function propsParameter(context, node) {
  if (node.initializer || node.dotDotDotToken || node.modifiers?.length)
    reject(`Opaque client function parameter: ${context.path}`);
  if (ts.isIdentifier(node.name)) {
    bindingName(context, node.name);
    return;
  }
  if (!ts.isObjectBindingPattern(node.name) || !node.type || !ts.isTypeLiteralNode(node.type))
    reject(`Client props must be explicit scalar data: ${context.path}`);
  const fields = new Set();
  for (const field of node.type.members) {
    if (
      !ts.isPropertySignature(field) ||
      !ts.isIdentifier(field.name) ||
      !reviewedName(field.name.text) ||
      !field.type ||
      !scalarType(field.type) ||
      fields.has(field.name.text)
    )
      reject(`Unreviewed client prop type: ${context.path}`);
    fields.add(field.name.text);
  }
  for (const item of node.name.elements) {
    bindingName(context, item.name);
    if (
      item.dotDotDotToken ||
      item.initializer ||
      (item.propertyName && !ts.isIdentifier(item.propertyName)) ||
      !fields.has((item.propertyName ?? item.name).text)
    )
      reject(`Unreviewed client prop binding: ${context.path}`);
  }
}

function verifyFunction(context, node, nativeEvent = false) {
  if (
    !node.body ||
    node.asteriskToken ||
    node.modifiers?.some((item) => item.kind !== ts.SyntaxKind.ExportKeyword)
  )
    reject(`Unreviewed executable client function: ${context.path}`);
  for (const parameter of node.parameters) {
    propsParameter(context, parameter);
    if (nativeEvent) {
      bindingName(context, parameter.name);
      context.eventParameters.add(parameter);
    }
  }
  verifyNode(context, node.body);
}

function verifyVariable(context, node) {
  if ((node.parent.flags & ts.NodeFlags.Const) === 0 || !node.initializer)
    reject(`Client variables must be local and immutable: ${context.path}`);
  if (ts.isArrayBindingPattern(node.name) && hookName(context, node.initializer) === "useState") {
    if (node.name.elements.length !== 2)
      reject(`Local state requires a fixed pair: ${context.path}`);
    for (const item of node.name.elements) {
      if (!ts.isBindingElement(item) || item.initializer || item.dotDotDotToken)
        reject(`Unreviewed local state binding: ${context.path}`);
      bindingName(context, item.name);
    }
  } else bindingName(context, node.name);
  verifyNode(context, node.initializer);
}

function verifyProperty(context, node) {
  if (
    ts.isIdentifier(node.expression) &&
    imported(context, node.expression)?.kind === "style" &&
    reviewedName(node.name.text)
  )
    return;
  if (EVENT_DATA.has(node.name.text) && eventReceiver(context, node.expression)) return;
  reject(`Unreviewed client property access: ${context.path}#${node.name.text}`);
}

function verifyNode(context, node) {
  if (++context.nodes > MAX_NODES) reject(`Client effect AST budget exceeded: ${context.path}`);
  if (context.capabilityNodes.has(node) || LITERAL.has(node.kind)) return;
  if (ts.isArrowFunction(node)) {
    if (context.stateUpdaters.has(node)) return verifyFunction(context, node);
    reject(`Client callbacks may only be local events or state updates: ${context.path}`);
  }
  if (ts.isIdentifier(node)) return dataIdentifier(context, node);
  if (ts.isCallExpression(node)) return verifyCall(context, node);
  if (ts.isPropertyAccessExpression(node)) return verifyProperty(context, node);
  if (ts.isFunctionDeclaration(node)) return verifyFunction(context, node);
  if (ts.isVariableDeclaration(node)) return verifyVariable(context, node);
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    return verifyElement(context, node);
  if (inertJsxNode(node)) return;
  verifyExpression(context, node);
}

function inertJsxNode(node) {
  return (
    ts.isJsxClosingElement(node) ||
    ts.isJsxText(node) ||
    ts.isJsxOpeningFragment(node) ||
    ts.isJsxClosingFragment(node)
  );
}

function verifyExpression(context, node) {
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression))
    return verifyNode(context, node.expression);
  if (ts.isBinaryExpression(node) && BINARY.has(node.operatorToken.getText(context.tree))) {
    verifyNode(context, node.left);
    return verifyNode(context, node.right);
  }
  if (
    ts.isPrefixUnaryExpression(node) &&
    [ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(
      node.operator,
    )
  )
    return verifyNode(context, node.operand);
  if (COMPOSITE.has(node.kind) || ts.isJsxElement(node)) {
    ts.forEachChild(node, (child) => {
      verifyNode(context, child);
    });
    return;
  }
  reject(`Unreviewed client effect syntax (${ts.SyntaxKind[node.kind]}): ${context.path}`);
}

function moduleRecord(path, read) {
  const tree = parse(path, read(path));
  const [directive] = tree.statements;
  if (
    !directive ||
    !ts.isExpressionStatement(directive) ||
    !ts.isStringLiteral(directive.expression) ||
    directive.expression.text !== "use client" ||
    tree.referencedFiles.length ||
    tree.typeReferenceDirectives.length ||
    tree.libReferenceDirectives.length
  )
    reject(`Explicit local client module required: ${path}`);
  const exports = new Set();
  for (const node of tree.statements.slice(1)) {
    if (!exportedFunction(node)) continue;
    if (!reviewedName(node.name.text) || exports.has(node.name.text))
      reject(`Duplicate or invalid client export: ${path}`);
    exports.add(node.name.text);
  }
  if (!exports.size) reject(`Client module requires a named function export: ${path}`);
  return { tree, exports };
}

function verifyBindings(context) {
  const declarations = new Set();
  for (const node of context.tree.statements.slice(1)) {
    if (!ts.isFunctionDeclaration(node) || !node.name) continue;
    const name = node.name.text;
    if (declarations.has(name) || context.imports.has(name))
      reject(`Duplicate client module binding: ${context.path}`);
    declarations.add(name);
  }
}

function functionContracts(context, body, expectedExports) {
  const signatures = [];
  for (const node of body) {
    if (!ts.isFunctionDeclaration(node)) continue;
    if (!node.name || node.typeParameters?.length)
      reject(`Client functions require named finite parameters: ${context.path}`);
    bindingName(context, node.name);
    if (expectedExports?.has(node.name.text)) signatures.push(rendererContract(context, node));
    verifyFunction(context, node);
  }
  return signatures;
}

function rendererContract(context, node) {
  if (
    !exportedFunction(node) ||
    node.parameters.length > 1 ||
    (node.parameters.length && !ts.isObjectBindingPattern(node.parameters[0].name))
  )
    reject(`Renderer requires an exact named scalar-props export: ${context.path}`);
  return {
    name: node.name.text,
    props: node.parameters.map((param) => printed(context.tree, param.type)),
  };
}

function validateTree(context, expectedExports) {
  const { tree, path } = context;
  const body = tree.statements.slice(1);
  for (const node of body) {
    if (ts.isImportDeclaration(node)) importBinding(context, node);
    else if (!ts.isFunctionDeclaration(node))
      reject(`Client module may only declare functions: ${path}`);
  }
  verifyBindings(context);
  const checked = verifyCapabilityUses({
    tree,
    path,
    imports: context.imports,
    checker: context.checker,
    reject,
  });
  context.capabilityNodes = checked.nodes;
  const signatures = functionContracts(context, body, expectedExports);
  const expected = expectedExports ? [...expectedExports].sort(order) : [];
  if (
    expectedExports &&
    canonical([...context.modules.get(path).exports].sort(order)) !== canonical(expected)
  )
    reject(`Renderer export contract differs from the immutable mount: ${path}`);
  return { effects: fingerprintUses(context), signatures, edges: [...context.edges].sort(order) };
}

function printed(tree, node) {
  if (!node) reject(`Client renderer requires a typed props contract: ${tree.fileName}`);
  return printer.printNode(ts.EmitHint.Unspecified, node, tree).replace(/\r?\n\s*/gu, " ");
}

function effectTarget(node) {
  return ts.isCallExpression(node) ? node.expression : node.tagName;
}

function effectOwner(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name) return parent.name.text;
  }
  return undefined;
}

function componentUseShape(context, node) {
  // A capability inside a keyed ancestor may remount when the key changes.
  // Binding wrapper tag/key paths preserves this part of React identity while
  // leaving text, classes and ordinary presentation attributes editable.
  const parents = [];
  for (
    let child = node;
    child.parent && !ts.isReturnStatement(child.parent);
    child = child.parent
  ) {
    const parent = child.parent;
    if (!ts.isJsxElement(parent) && !ts.isJsxFragment(parent)) continue;
    const index = parent.children
      .filter((node) => !ts.isJsxText(node) || node.text.trim())
      .indexOf(child);
    if (ts.isJsxFragment(parent)) {
      parents.push({ tag: "<>", index });
      continue;
    }
    const { tagName, attributes } = parent.openingElement;
    const key = attributes.properties.find(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        ts.isIdentifier(attribute.name) &&
        attribute.name.text === "key",
    );
    if (key)
      reject(`Capability component cannot be wrapped by keyed presentation: ${context.path}`);
    parents.push({ tag: tagName.getText(context.tree), index });
  }
  return parents;
}

function fingerprintUses(context) {
  const { path, capabilityNodes, files } = context;
  const effects = [];
  const calls = [...capabilityNodes].sort((left, right) => left.getStart() - right.getStart());
  for (const call of calls) {
    const target = effectTarget(call);
    const binding = imported(context, target);
    const owner = effectOwner(call);
    if (!binding || !owner || !context.roots.get(path)?.has(owner))
      reject(`Effect owner is outside the terminal renderer contract: ${path}`);
    effects.push({
      owner,
      consumer: path,
      provider: binding.path,
      blob: files.get(binding.path).blob,
      export: binding.name,
      kind: binding.kind,
      wrappers: binding.kind === "capability-component" ? componentUseShape(context, call) : [],
    });
  }
  return effects;
}

function verifyStylesheet(path, source) {
  let tree;
  try {
    tree = postcss.parse(source, { from: path });
  } catch {
    reject(`Unparseable client stylesheet: ${path}`);
  }
  tree.walk((node) => {
    if (node.type === "comment") return;
    if (
      node.type === "rule" &&
      node.parent?.type === "root" &&
      /^\.[A-Za-z][A-Za-z0-9_-]*(?::(?:focus-visible|focus-within|focus|hover|active|disabled))?$/u.test(
        node.selector,
      )
    )
      return;
    if (
      node.type === "decl" &&
      node.parent?.type === "rule" &&
      STYLE_PROPERTY.test(node.prop) &&
      !node.important &&
      /^[A-Za-z0-9_#(),.%+*/ -]+$/u.test(node.value) &&
      [...node.value.matchAll(/([A-Za-z_-]+)\s*\(/gu)].every((match) =>
        STYLE_FUNCTION.test(match[1]),
      )
    )
      return;
    reject(`Client stylesheet must use local non-resource syntax: ${path}`);
  });
}

function inventory(files, profile) {
  const paths = [
    ...profile.modules,
    ...profile.styles,
    ...profile.capabilities.map(({ path }) => path),
  ];
  let bytes = 0;
  for (const path of paths) {
    const entry = files.get(path);
    if (entry?.mode !== "100644")
      reject(`Selected client source must be a regular Git blob: ${path}`);
    bytes += entry.bytes;
    if (bytes > MAX_SOURCE_BYTES) reject("Selected client source exceeds its byte budget");
  }
  return new Map(paths.map((path) => [path, files.get(path)]));
}

function verifyGraph(records, styles, roots) {
  const active = new Set();
  const done = new Set();
  function visit(path) {
    if (active.has(path)) reject(`Selected client graph contains a cycle: ${path}`);
    if (done.has(path)) return;
    active.add(path);
    for (const target of records.get(path)?.edges ?? []) visit(target);
    active.delete(path);
    done.add(path);
  }
  for (const path of roots.keys()) visit(path);
  if (done.size !== records.size + styles.size)
    reject("Selected client source must be exactly reachable from the renderer roots");
}

function snapshot(root, files, profile, roots) {
  const selected = inventory(files, profile);
  const read = createWebGitSourceReader(root, selected);
  const modules = new Map(profile.modules.map((path) => [path, moduleRecord(path, read)]));
  const styles = new Set(profile.styles);
  const providers = new Map(profile.capabilities.map((contract) => [contract.path, contract]));
  for (const [path, contract] of providers)
    verifyCapabilityProvider(parse(path, read(path)), contract, reject);
  for (const path of styles) verifyStylesheet(path, read(path));
  const records = new Map();
  for (const [path, { tree }] of modules) {
    const context = {
      tree,
      path,
      checker: checkerFor(tree),
      files,
      modules,
      styles,
      providers,
      roots,
      imports: new Map(),
      edges: new Set(),
      eventParameters: new Set(),
      stateUpdaters: new Set(),
      capabilityNodes: new Set(),
      nodes: 0,
    };
    records.set(path, validateTree(context, roots.get(path)));
  }
  verifyGraph(records, styles, roots);
  const effects = [...records.values()].flatMap(({ effects }) => effects);
  const contracts = [...records]
    .filter(([path]) => roots.has(path))
    .map(([path, { signatures }]) => [path, signatures]);
  return {
    effects,
    contracts,
    subtree: [...selected.values()]
      .sort((left, right) => order(left.path, right.path))
      .map((entry) => ({ ...entry, edges: records.get(entry.path)?.edges ?? [] })),
  };
}

async function providerClosure(root, files, profile) {
  if (!profile.capabilities.length) return [];
  const graph = await inspectWebProjectionSnapshot(root, files, new Set());
  const selected = new Set([...profile.modules, ...profile.styles]);
  const references = new Map();
  for (const row of graph.references) {
    if (!references.has(row.from)) references.set(row.from, []);
    references.get(row.from).push(row);
  }
  const records = new Map();
  const pending = profile.capabilities.map(({ path }) => path);
  while (pending.length) {
    const path = pending.pop();
    if (records.has(path)) continue;
    if (selected.has(path))
      reject(`Protected client capability reaches mutable presentation: ${path}`);
    const entry = files.get(path);
    if (entry?.mode !== "100644") reject(`Protected client capability source is missing: ${path}`);
    const edges = (references.get(path) ?? []).map(({ specifier, targets }) => {
      if ((specifier.startsWith(".") || specifier.startsWith("@/")) && !targets.length)
        reject(`Unresolved protected client capability dependency: ${path}`);
      if (specifier.startsWith("@ui-sdk/"))
        reject(`Protected capability cannot depend on the Web SDK: ${path}`);
      pending.push(...targets);
      return { specifier, targets };
    });
    records.set(path, { ...entry, edges });
  }
  return [...records.values()].sort((left, right) => order(left.path, right.path));
}

function verifyAuthority(before, after, cuts, providers) {
  for (const { from } of cuts) {
    const old = before.get(from);
    if (old?.mode !== "100644" || canonical(old) !== canonical(after.get(from) ?? null))
      reject(`Client renderer mount changed: ${from}`);
  }
  for (const { path } of providers) {
    const old = before.get(path);
    if (old?.mode !== "100644" || canonical(old) !== canonical(after.get(path) ?? null))
      reject(`Protected client capability source changed: ${path}`);
  }
}

/**
 * Use with the independently verified structural delta and protected projection.
 * Both selected Git subtrees must fit this grammar. SDK/CSS behavior and all
 * runtime authorization still require the existing lock and native controls.
 */
export async function verifyWebClientEffectProjection({
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
    reject("Canonical Git root and two distinct client revisions required");
  const checked = admittedProfile(profile);
  runWebGit(root, ["merge-base", "--is-ancestor", baselineRevision, currentRevision]);
  const before = readWebGitTree(root, baselineRevision);
  const after = readWebGitTree(root, currentRevision);
  verifyAuthority(before, after, profile.rendererCuts, checked.before.capabilities);
  const old = snapshot(root, before, checked.before, checked.roots);
  const next = snapshot(root, after, checked.after, checked.roots);
  if (canonical(old.effects) !== canonical(next.effects))
    reject("Client capability call fingerprints differ");
  if (canonical(old.contracts) !== canonical(next.contracts))
    reject("Client renderer props contract differs");
  const oldProviders = await providerClosure(root, before, checked.before);
  const nextProviders = await providerClosure(root, after, checked.after);
  if (canonical(oldProviders) !== canonical(nextProviders))
    reject("Protected client capability source graph differs");
  return {
    schemaVersion: 1,
    kind: "warpdrive-web-client-effect-projection",
    baselineRevision,
    currentRevision,
    profileSha256: hash(profile),
    rendererCutsSha256: hash(profile.rendererCuts),
    effectSha256: hash(next.effects),
    capabilitySourceSha256: hash(nextProviders),
    rendererContractSha256: hash(next.contracts),
    baselineSubtreeSha256: hash(old.subtree),
    candidateSubtreeSha256: hash(next.subtree),
    capabilityUses: next.effects.length,
    deploymentAuthorized: false,
  };
}
