import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import postcss from "postcss";
import ts from "typescript";

// This is a bounded omission policy, not a replacement for the Next build or release tests.
// Everything else in the conservative repository inventory remains a Web input.
export const WEB_EXCLUSIONS = [
  "src/server/worker.ts",
  "src/features/release/job.ts",
  "src/features/privacy/registryIdsInfrastructure2.ts",
];
export const WEB_SOURCE_RULES = WEB_EXCLUSIONS.map(
  (path) => `@source not "../${path.slice("src/".length)}";`,
);
const REVIEWED = {
  "next.config.ts": "19734143231672763194cf18fb9f683edce125fd01fcabe506992d3af4efa10b",
  "postcss.config.mjs": "b783348d5618047d0f37e12acd15c5a2c5f02809d8711e0764c9cea52750346c",
  "src/config/developmentCache.ts":
    "a568b3224411d19865ae771d72d13c67cf4d87509789806b46e33992f2472697",
  "src/config/env.ts": "3f60b2d4fb85f9f3f0534f91e71d27dd654b3b5988e0844e58a63c000838f59b",
  "src/features/release/currentVersion.ts":
    "98fe2b01a8ad364ca2db966af5378fd941560130dc22310f549c5705c3345ac2",
  "src/features/workflows/v2/codeSandbox.ts":
    "ed157c6038258bcd5efea15aeb1ab36457fce846c345c6290446e806d1c69c2b",
  "patches/next@16.4.3.patch": "dfe3c2ebd8572893cbd9ae759413aa520dce10fb4479f40203f1c620b2b2493e",
  "patches/shadcn@4.23.0.patch": "75bd1aa3fb9742bf1356fa05a439c893ede7bf6ecaa7fa4b5041c1c9a598f434",
};
const REVIEWED_NEXT_WITHOUT_MESSAGE_LIST =
  "3fa2d62ef09954d3c7f1399ba986586eff0a561a01d90e2bd2b4c3a6fabd4609";
// Audited host-global caches and the QuickJS helper's Bun.Transpiler access. Printing without
// comments admits source-membership positive controls, while every executable/type change
// needs review. This is not a filename-only exception for future global/reflective loaders.
const REVIEWED_HOST_GLOBAL_SYNTAX = {
  "src/jobs/boss.ts": "93a20735512e6f5fb7c69ffb64627b10d130ca418b93176714fec8553f7881ee",
  "src/db/client.ts": "958f6adb2b9c32c41ab82f0884b3281c0fd2baf7261ef67db6d9244b3d88c432",
  "src/server/rateLimitGuard.ts":
    "1bc990b58d49ba79231d1fe04fd678194a98c306df69173e395b14e0e2996f2a",
  "src/features/workflows/v2/codeWorker.ts":
    "0b8cb76faf96e3fa8434508c1d6ad4024bb0b6dc68a8bf754c05f2b58ca5713e",
  "src/features/deals/winChime.ts":
    "e4715efdeadadb3091deda056ebb54b2a5a33f2d1856c3e3955d5d4eae353b88",
};
const TOOLCHAIN = {
  next: "16.4.6",
  "next-intl": "4.14.10",
  tailwindcss: "4.3.5",
  "@tailwindcss/postcss": "4.3.5",
  typescript: "6.0.3",
  postcss: "8.5.32",
  shadcn: "4.23.0",
  "tw-animate-css": "1.4.0",
};
const FORBIDDEN_CONFIGS = [
  "next.config.js",
  "next.config.mjs",
  "next.config.mts",
  "jsconfig.json",
  ".swcrc",
  ".babelrc",
  ".babelrc.json",
  ".babelrc.js",
  ".babelrc.mjs",
  ".babelrc.cjs",
  "babel.config.js",
  "babel.config.json",
  "babel.config.mjs",
  "babel.config.cjs",
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.ts",
  "postcss.config.json",
  ".postcssrc",
  ".postcssrc.json",
  ".postcssrc.js",
  ".postcssrc.cjs",
  ".postcssrc.yml",
  "app",
  "pages",
  "src/pages",
];
const OPTIONAL_ROOTS = ["proxy", "middleware", "instrumentation", "instrumentation-client"].flatMap(
  (name) =>
    ["", "src/"].flatMap((prefix) =>
      ["ts", "tsx", "js", "jsx"].map((extension) => `${prefix}${name}.${extension}`),
    ),
);
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const SOURCE = /\.[cm]?[jt]sx?$/u;
const APP_ENTRY =
  /^(?:page|layout|loading|error|global-error|global-not-found|not-found|template|default|route|forbidden|unauthorized|robots|sitemap|manifest|favicon|icon\d*|apple-icon\d*|opengraph-image\d*|twitter-image\d*)\.(?:tsx?|jsx?)$/u;
const OPAQUE_BUILTINS = /^(?:node:)?(?:fs(?:\/promises)?|module|child_process|vm|process)$/u;
const REVIEWED_CSS_PACKAGES = ["tailwindcss", "tw-animate-css", "shadcn/tailwind.css"];
const LOCAL_EXTENSIONS = [
  ".js",
  ".mjs",
  ".tsx",
  ".ts",
  ".jsx",
  ".json",
  ".wasm",
  ".mts",
  ".cts",
  ".cjs",
  ".d.ts",
  ".d.mts",
  ".d.cts",
];
const PACKAGE_RESOLVER_FIELDS = [
  "browser",
  "imports",
  "exports",
  "alias",
  "main",
  "module",
  "types",
  "typings",
  "type",
];
const REVIEWED_ROOT_PACKAGE_FIELDS = { main: "index.js" };
const SAFE_GLOBAL_PROPERTIES = ["fetch", "crypto", "localStorage"];
const REFLECTIVE_LOADER_PROPERTIES = [
  "constructor",
  "__proto__",
  "eval",
  "Function",
  "Bun",
  "Deno",
  "require",
  "getBuiltinModule",
  "createRequire",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const WEB_INPUT_POLICY = {
  mode: "conservative-repository-sources-with-guarded-exact-omissions-v1",
  exclusions: WEB_EXCLUSIONS,
  sourceRules: WEB_SOURCE_RULES,
  stylesheet: "src/app/globals.css",
  reachability: "fresh-typescript-ast-app-file-conventions-helpers-and-implicit-next-intl-roots",
  appEntryPattern: APP_ENTRY.source,
  optionalRoots: OPTIONAL_ROOTS,
  typeOnlyEdges: "retained-conservatively",
  resolver: "reviewed-bundler-alias-relative-static-imports-no-development-pruning",
  reviewedSourceSha256: REVIEWED,
  reviewedHostGlobalSyntaxSha256: REVIEWED_HOST_GLOBAL_SYNTAX,
  nextConfigWithoutMessageListSha256: REVIEWED_NEXT_WITHOUT_MESSAGE_LIST,
  reviewedLockedVersions: TOOLCHAIN,
  cssPackageImports: REVIEWED_CSS_PACKAGES,
  localResolution: {
    candidateExtensions: LOCAL_EXTENSIONS,
    mode: "traverse-all-existing-exact-extension-and-index-candidates",
    explicitRuntimeExtensionSubstitution: "reject",
  },
  nestedPackageResolverFields: [...PACKAGE_RESOLVER_FIELDS, "name"],
  reviewedRootPackageFields: REVIEWED_ROOT_PACKAGE_FIELDS,
  safeDirectGlobalProperties: SAFE_GLOBAL_PROPERTIES,
  reflectiveLoaderProperties: REFLECTIVE_LOADER_PROPERTIES,
  constructorMetadata: "direct-constructor-name-read-only-never-constructor-value-or-reflection",
  forbiddenConfigurations: FORBIDDEN_CONFIGS,
  limits: { modules: 10_000, sourceBytes: 32 * 1024 * 1024 },
  opaqueAccess: "reviewed-source-contract-or-reject",
  scope: "first-party-static-runtime-boundary-not-a-Next-production-graph-or-release-qualification",
};

function createGuardContext(options) {
  const paths = new Set(options.files);
  const directories = new Set([""]);
  for (const path of options.files) {
    const parts = path.split("/");
    for (let length = 1; length < parts.length; length++)
      directories.add(parts.slice(0, length).join("/"));
  }
  return {
    ...options,
    paths,
    exists: (path) => paths.has(path) || directories.has(path),
    failClosed: (reason) => options.fail(`Web omission policy rejected: ${reason}`),
  };
}

function omittedReferenceCandidates(context, text, from) {
  const candidates = [];
  if (text.startsWith("@/")) candidates.push(`src/${text.slice(2)}`);
  if (text.startsWith("src/")) candidates.push(text);
  if (text.startsWith("."))
    candidates.push(
      relative(context.root, resolve(context.root, dirname(from), text)).replaceAll("\\", "/"),
    );
  return candidates;
}

function rejectOmittedReference(context, value, from) {
  if (/^(?:data:|https?:|#)/u.test(value)) return;
  if (!/^(?:@\/|src\/|\.|\/|file:|%2e|%2f)/iu.test(value) && !value.includes("/src/")) return;
  let text;
  try {
    text = decodeURIComponent(value.split(/[?#]/u)[0]);
  } catch {
    context.failClosed(`unreviewed encoded asset reference ${from}`);
  }
  const candidates = omittedReferenceCandidates(context, text, from);
  for (const omitted of WEB_EXCLUSIONS)
    if (
      text.endsWith(`/${omitted}`) ||
      candidates.some((candidate) => candidate === omitted || `${candidate}.ts` === omitted)
    )
      context.failClosed(
        `Web reaches omitted source ${omitted} through a literal asset/reference in ${from}`,
      );
}

function checkConfigurationTopology(context) {
  for (const path of FORBIDDEN_CONFIGS)
    if (context.exists(path)) context.failClosed(`unreviewed configuration/topology ${path}`);
  if (
    PACKAGE_RESOLVER_FIELDS.some(
      (name) =>
        context.manifest[name] !== undefined &&
        context.manifest[name] !== REVIEWED_ROOT_PACKAGE_FIELDS[name],
    )
  )
    context.failClosed("unreviewed root package resolver mappings");
  if (ts.version !== TOOLCHAIN.typescript)
    context.failClosed("unreviewed TypeScript resolver version");
}

function unsupportedResolverOptions(config) {
  const options = config.compilerOptions ?? {};
  return (
    JSON.stringify(options.paths) !== JSON.stringify({ "@/*": ["./src/*"] }) ||
    [
      "baseUrl",
      "rootDirs",
      "customConditions",
      "moduleSuffixes",
      "typeRoots",
      "jsxImportSource",
      "jsxFactory",
      "jsxFragmentFactory",
    ].some((name) => options[name] !== undefined) ||
    (options.module !== undefined && options.module !== "esnext") ||
    config.references !== undefined ||
    options.noResolve === true ||
    (options.moduleResolution !== undefined && options.moduleResolution !== "bundler") ||
    (options.plugins !== undefined && JSON.stringify(options.plugins) !== '[{"name":"next"}]')
  );
}

async function reviewedResolverOptions(context) {
  const config = ts.parseConfigFileTextToJson("tsconfig.json", await context.read("tsconfig.json"));
  if (config.error || !config.config || config.config.extends !== undefined)
    context.failClosed("unreviewed tsconfig");
  if (unsupportedResolverOptions(config.config))
    context.failClosed("unreviewed tsconfig resolver options");
  const converted = ts.convertCompilerOptionsFromJson(
    config.config.compilerOptions ?? {},
    context.root,
  );
  if (converted.errors.length) context.failClosed("invalid TypeScript resolver options");
  return converted.options;
}

function messageDeclarationList(context, tree) {
  const lists = [];
  function collect(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === "createMessagesDeclaration")
      lists.push(node.initializer);
    ts.forEachChild(node, collect);
  }
  collect(tree);
  if (tree.parseDiagnostics.length || lists.length !== 1 || !ts.isArrayLiteralExpression(lists[0]))
    context.failClosed("unreviewed Next message declaration configuration");
  return lists[0];
}

function reviewedMessageFiles(context, list) {
  const files = [];
  for (const item of list.elements) {
    if (
      !ts.isStringLiteral(item) ||
      !/^\.\/src\/[a-zA-Z0-9_./()-]+\.json$/u.test(item.text) ||
      item.text
        .slice(2)
        .split("/")
        .some((part) => ["", ".", ".."].includes(part))
    )
      context.failClosed("nonliteral or escaping Next message declaration input");
    files.push(item.text.slice(2));
  }
  if (files.length > 500 || new Set(files).size !== files.length)
    context.failClosed("unbounded/repeated Next message declaration inputs");
  return files;
}

async function reviewedNextProfile(context) {
  const source = await context.read("next.config.ts");
  const empty = /^\s*export\s+default\s*\{\s*\}\s*;?\s*$/u.test(source);
  if (empty) return { empty, messageFiles: [] };
  const tree = ts.createSourceFile("next.config.ts", source, ts.ScriptTarget.Latest, true);
  const list = messageDeclarationList(context, tree);
  const messageFiles = reviewedMessageFiles(context, list);
  const normalized = source.slice(0, list.getStart(tree)) + "[]" + source.slice(list.getEnd());
  if (sha256(normalized) !== REVIEWED_NEXT_WITHOUT_MESSAGE_LIST)
    context.failClosed("next.config.ts changed; review implicit inputs and resolver hooks");
  return { empty, messageFiles };
}

async function checkPostcssConfiguration(context, profile) {
  if (context.exists("postcss.config.mjs")) {
    if (sha256(await context.read("postcss.config.mjs")) !== REVIEWED["postcss.config.mjs"])
      context.failClosed("PostCSS plugin configuration changed");
  } else if (!profile.empty) context.failClosed("missing reviewed PostCSS configuration");
}

async function checkFrameworkPatches(context) {
  for (const [name, path] of Object.entries(context.manifest.patchedDependencies ?? {})) {
    if (
      /^(?:next(?:-intl)?|@tailwindcss\/.+|tailwindcss|postcss|typescript|tw-animate-css|shadcn)@/u.test(
        name,
      ) &&
      (REVIEWED[path] === undefined || sha256(await context.read(path)) !== REVIEWED[path])
    )
      context.failClosed(`unreviewed framework/toolchain patch ${name}`);
  }
}

function checkLockedToolchain(context) {
  for (const [name, version] of Object.entries(TOOLCHAIN)) {
    const candidates = Object.entries(context.lock.packages ?? {}).filter(
      ([key, value]) => key === name || (Array.isArray(value) && value[0] === `${name}@${version}`),
    );
    if (!candidates.length || candidates.some(([, value]) => value[0] !== `${name}@${version}`))
      context.failClosed(`unreviewed locked ${name} version`);
  }
}

function webRoots(context, profile) {
  const stylesheet = "src/app/globals.css";
  if (!context.exists(stylesheet)) context.failClosed("missing Tailwind boundary stylesheet");
  const roots = ["next.config.ts", stylesheet, ...context.helperEntries.map((entry) => entry.in)];
  roots.push(
    ...context.files.filter(
      (path) => path.startsWith("src/app/") && APP_ENTRY.test(path.split("/").at(-1)),
    ),
  );
  roots.push(...OPTIONAL_ROOTS.filter((path) => context.paths.has(path)));
  if (!profile.empty) roots.push("src/features/i18n/request.ts", ...profile.messageFiles);
  return roots;
}

function createGraph(context, options, roots) {
  const host = {
    fileExists: (path) => context.paths.has(relative(context.root, path).replaceAll("\\", "/")),
    readFile: () => undefined,
    directoryExists: (path) => context.exists(relative(context.root, path).replaceAll("\\", "/")),
    getCurrentDirectory: () => context.root,
    realpath: (path) => path,
  };
  return {
    context,
    options,
    host,
    resolutionCache: ts.createModuleResolutionCache(context.root, (path) => path, options),
    seen: new Set(),
    pending: roots,
    checkedPackageScopes: new Set(),
    sourceBytes: 0,
  };
}

async function readGraphSource(graph, path) {
  const source = await graph.context.read(path);
  graph.sourceBytes += Buffer.byteLength(source);
  if (graph.sourceBytes > WEB_INPUT_POLICY.limits.sourceBytes)
    graph.context.failClosed("source graph byte cap exceeded");
  return source;
}

async function checkNestedPackage(graph, path) {
  const source = await readGraphSource(graph, path);
  let nested;
  try {
    nested = JSON.parse(source);
  } catch {
    graph.context.failClosed(`unparseable nested package scope ${path}`);
  }
  if (
    nested === null ||
    typeof nested !== "object" ||
    Array.isArray(nested) ||
    [...PACKAGE_RESOLVER_FIELDS, "name"].some((key) => nested[key] !== undefined)
  )
    graph.context.failClosed(`unreviewed nested package resolver/self-reference scope ${path}`);
  graph.checkedPackageScopes.add(path);
}

async function checkPackageScopes(graph, path) {
  let directory = dirname(path);
  while (directory !== ".") {
    const packageFile = `${directory}/package.json`;
    if (graph.context.paths.has(packageFile) && !graph.checkedPackageScopes.has(packageFile))
      await checkNestedPackage(graph, packageFile);
    directory = dirname(directory);
  }
}

function admitExternalSpecifier(graph, specifier, from) {
  const { context } = graph;
  if (
    isAbsolute(specifier) ||
    specifier.startsWith("#") ||
    specifier.startsWith("node:") ||
    specifier.includes("\\") ||
    specifier.includes(":")
  )
    context.failClosed(`opaque module specifier in ${from}`);
  const name = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  if (name === context.manifest.name)
    context.failClosed(`unreviewed root package self-reference ${from}`);
  if (!Object.hasOwn(context.production, name))
    context.failClosed(`undeclared runtime package ${name} in ${from}`);
}

function localBaseCandidate(graph, specifier, from) {
  const { root } = graph.context;
  return specifier.startsWith("@/")
    ? relative(root, resolve(root, "src", specifier.slice(2))).replaceAll("\\", "/")
    : relative(root, resolve(root, dirname(from), specifier)).replaceAll("\\", "/");
}

function localCandidates(graph, specifier, from) {
  const { root, paths, failClosed } = graph.context;
  const target = ts.resolveModuleName(
    specifier,
    resolve(root, from),
    graph.options,
    graph.host,
    graph.resolutionCache,
  ).resolvedModule?.resolvedFileName;
  const candidate = localBaseCandidate(graph, specifier, from);
  if (candidate.startsWith("../") || isAbsolute(candidate))
    failClosed(`escaping local edge ${from}`);
  const resolvedPath = target ? relative(root, target).replaceAll("\\", "/") : undefined;
  if (
    [".js", ".mjs", ".cjs"].includes(extname(candidate)) &&
    resolvedPath !== undefined &&
    resolvedPath !== candidate
  )
    failClosed(`unreviewed explicit JavaScript extension substitution ${from} -> ${specifier}`);
  const candidates = new Set([candidate]);
  // Include dotted requests too: webpack appends extensions independently of TS precedence.
  for (const extension of LOCAL_EXTENSIONS) candidates.add(`${candidate}${extension}`);
  for (const extension of LOCAL_EXTENSIONS) candidates.add(`${candidate}/index${extension}`);
  if (resolvedPath !== undefined) candidates.add(resolvedPath);
  const found = [...candidates].filter((path) => paths.has(path));
  if (!found.length) failClosed(`unresolved local edge ${from} -> ${specifier}`);
  return found;
}

function enqueue(graph, specifier, from) {
  if (BUILTINS.has(specifier)) return;
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
    admitExternalSpecifier(graph, specifier, from);
    return;
  }
  for (const path of localCandidates(graph, specifier, from)) {
    if (path.startsWith("../") || isAbsolute(path))
      graph.context.failClosed(`escaping or unbounded module edge ${from}`);
    graph.pending.push(path);
  }
}

function parseStylesheet(context, css, path) {
  try {
    return postcss.parse(css, { from: path });
  } catch {
    context.failClosed(`unparseable stylesheet ${path}`);
  }
}

function inspectCssImport(graph, path, rule, state) {
  const match = /^(["'])([^"']+)\1(?:\s+layer\([^)]*\))?$/u.exec(rule.params);
  if (!match) graph.context.failClosed(`opaque CSS import ${path}`);
  if (match[2] === "tailwindcss") state.tailwind = true;
  if (match[2].startsWith(".")) enqueue(graph, match[2], path);
  else if (!REVIEWED_CSS_PACKAGES.includes(match[2]))
    graph.context.failClosed(`unreviewed CSS package ${path}`);
}

function inspectCssRule(graph, path, rule, state) {
  if (rule.name.includes("\\") || rule.params.includes("\\"))
    graph.context.failClosed(`unreviewed escaped CSS loader syntax ${path}`);
  if (rule.name === "source") state.directives.push(`@source ${rule.params};`);
  if (["config", "plugin"].includes(rule.name))
    graph.context.failClosed(`unreviewed Tailwind loader ${path}`);
  if (rule.name === "import") inspectCssImport(graph, path, rule, state);
  if (rule.name === "source" && path !== "src/app/globals.css")
    graph.context.failClosed(`unreviewed Tailwind source root ${path}`);
}

function validateCssBoundary(context, path, state) {
  if (path === "src/app/globals.css") {
    if (
      !state.tailwind ||
      state.directives.length !== WEB_SOURCE_RULES.length ||
      WEB_SOURCE_RULES.some((rule) => !state.directives.includes(rule))
    )
      context.failClosed("Tailwind source exclusions differ from the Web input exclusions");
  } else if (state.tailwind) context.failClosed(`unreviewed Tailwind source root ${path}`);
}

function inspectCssDeclaration(context, path, declaration) {
  if (
    WEB_EXCLUSIONS.some(
      (excluded) =>
        declaration.value.includes(excluded) ||
        declaration.value.replaceAll("../", "").includes(excluded.slice(4)),
    )
  )
    context.failClosed(`opaque CSS reference to omitted source ${path}`);
  for (const match of declaration.value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gu)) {
    if (match[1].includes("\\"))
      context.failClosed(`unreviewed escaped CSS asset reference ${path}`);
    rejectOmittedReference(context, match[1].trim(), path);
  }
}

async function inspectStylesheet(graph, path) {
  const parsed = parseStylesheet(graph.context, await readGraphSource(graph, path), path);
  const state = { tailwind: false, directives: [] };
  parsed.walkAtRules((rule) => inspectCssRule(graph, path, rule, state));
  validateCssBoundary(graph.context, path, state);
  parsed.walkDecls((declaration) => inspectCssDeclaration(graph.context, path, declaration));
}

function typeOrPropertyName(node) {
  if (
    (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
    ((ts.isPropertyAssignment(node.parent) ||
      ts.isPropertySignature(node.parent) ||
      ts.isMethodDeclaration(node.parent)) &&
      node.parent.name === node)
  )
    return true;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isTypeNode(parent)) return true;
    if (ts.isExpression(parent) || ts.isStatement(parent)) break;
  }
  return false;
}

function transparentExpression(node) {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  );
}

function outerExpression(node) {
  let outer = node;
  while (outer.parent && transparentExpression(outer.parent)) outer = outer.parent;
  return outer;
}

function innerExpression(node) {
  let inner = node;
  while (transparentExpression(inner)) inner = inner.expression;
  return inner;
}

function boundModuleParameter(node) {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (
      ts.isFunctionLike(parent) &&
      parent.parameters.some(
        (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === "module",
      )
    )
      return true;
  return false;
}

function inspectHostGlobal(script, node) {
  if (
    !ts.isIdentifier(node) ||
    !["globalThis", "global", "process", "Bun", "Deno", "eval", "Function", "module"].includes(
      node.text,
    ) ||
    typeOrPropertyName(node) ||
    (node.text === "module" && boundModuleParameter(node))
  )
    return;
  const outer = outerExpression(node),
    parent = outer.parent;
  if (ts.isTypeOfExpression(parent)) return;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === outer) {
    if (
      ["globalThis", "global"].includes(node.text) &&
      SAFE_GLOBAL_PROPERTIES.includes(parent.name.text)
    )
      return;
    if (
      node.text === "process" &&
      !["binding", "_linkedBinding", "getBuiltinModule", "mainModule", "dlopen"].includes(
        parent.name.text,
      )
    )
      return;
  }
  script.flags.opaqueHostGlobal = true;
}

function reflectivePropertyAccess(node) {
  if (
    !ts.isPropertyAccessExpression(node) ||
    !REFLECTIVE_LOADER_PROPERTIES.includes(node.name.text)
  )
    return false;
  // Existing Error.constructor.name logging receives no permission to obtain its constructor.
  return !(
    node.name.text === "constructor" &&
    ts.isPropertyAccessExpression(node.parent) &&
    node.parent.expression === node &&
    node.parent.name.text === "name"
  );
}

function reflectiveElementAccess(node) {
  if (!ts.isElementAccessExpression(node)) return false;
  const property = node.argumentExpression;
  return (
    ts.isFunctionLike(innerExpression(node.expression)) ||
    ((ts.isStringLiteral(property) || ts.isNoSubstitutionTemplateLiteral(property)) &&
      REFLECTIVE_LOADER_PROPERTIES.includes(property.text))
  );
}

function reflectiveLoaderCall(node, tree) {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    !["Reflect", "Object"].includes(node.expression.expression.getText(tree))
  )
    return false;
  const property = node.arguments[1];
  return (
    node.expression.name.text === "construct" ||
    (property &&
      (ts.isStringLiteral(property) || ts.isNoSubstitutionTemplateLiteral(property)) &&
      REFLECTIVE_LOADER_PROPERTIES.includes(property.text))
  );
}

function opaqueThreadBinding(node) {
  const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : undefined;
  return (
    !bindings ||
    !ts.isNamedImports(bindings) ||
    bindings.elements.some(
      (binding) =>
        !["parentPort", "workerData"].includes((binding.propertyName ?? binding.name).text),
    )
  );
}

function addModuleEdge(script, specifier) {
  if (OPAQUE_BUILTINS.test(specifier)) script.flags.opaque = true;
  enqueue(script.graph, specifier, script.path);
}

function inspectStaticImport(script, node) {
  if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier)
    return;
  if (!ts.isStringLiteral(node.moduleSpecifier))
    script.graph.context.failClosed(`opaque static import ${script.path}`);
  addModuleEdge(script, node.moduleSpecifier.text);
  if (/^(?:node:)?worker_threads$/u.test(node.moduleSpecifier.text) && opaqueThreadBinding(node))
    script.flags.opaque = true;
}

function literalLoaderArgument(script, node) {
  const arg = node.arguments[0];
  if (
    node.arguments.length !== 1 ||
    !arg ||
    (!ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg))
  )
    script.graph.context.failClosed(`nonliteral module loader ${script.path}`);
  return arg.text;
}

function inspectModuleCall(script, node) {
  if (!ts.isCallExpression(node)) return;
  if (
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require")
  ) {
    const specifier = literalLoaderArgument(script, node);
    addModuleEdge(script, specifier);
    if (/^(?:node:)?worker_threads$/u.test(specifier)) script.flags.opaque = true;
  }
  if (ts.isIdentifier(node.expression) && ["eval", "Function"].includes(node.expression.text))
    script.graph.context.failClosed(`opaque executable loader ${script.path}`);
}

function indirectRequireReference(node) {
  return (
    ts.isIdentifier(node) &&
    node.text === "require" &&
    !(ts.isCallExpression(node.parent) && node.parent.expression === node) &&
    !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
  );
}

function computedHostAccess(node, tree) {
  return (
    ts.isElementAccessExpression(node) &&
    ["globalThis", "process", "Bun", "Deno", "module"].includes(node.expression.getText(tree))
  );
}

function directHostAccess(node, tree) {
  return (
    ts.isPropertyAccessExpression(node) &&
    (["Bun", "Deno", "module"].includes(node.expression.getText(tree)) ||
      (node.expression.getText(tree) === "globalThis" &&
        ["require", "eval", "Function", "Bun", "Deno"].includes(node.name.text)))
  );
}

function inspectHostLoaderAccess(script, node) {
  const { failClosed } = script.graph.context;
  if (indirectRequireReference(node)) failClosed(`aliased or indirect require ${script.path}`);
  if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword)
    failClosed(`unreviewed import.meta loader ${script.path}`);
  if (computedHostAccess(node, script.tree))
    failClosed(`computed host loader access ${script.path}`);
  if (directHostAccess(node, script.tree))
    failClosed(`unreviewed host loader access ${script.path}`);
  if (
    ts.isPropertyAccessExpression(node) &&
    ["getBuiltinModule", "mainModule", "dlopen", "createRequire", "_load"].includes(node.name.text)
  )
    failClosed(`indirect host module loader ${script.path}`);
}

function inspectNewExpression(script, node) {
  if (!ts.isNewExpression(node)) return;
  const name = node.expression.getText(script.tree);
  if (["Worker", "SharedWorker"].includes(name) || /\.Worker$/u.test(name))
    script.flags.opaque = true;
  if (name === "Function")
    script.graph.context.failClosed(`opaque executable loader ${script.path}`);
  if (name === "URL" && node.arguments?.[1]?.getText(script.tree) === "import.meta.url")
    script.graph.context.failClosed(`unreviewed import.meta asset loader ${script.path}`);
}

function inspectScriptNode(script, node) {
  inspectHostGlobal(script, node);
  if (
    reflectivePropertyAccess(node) ||
    reflectiveElementAccess(node) ||
    reflectiveLoaderCall(node, script.tree)
  )
    script.flags.opaqueHostGlobal = true;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    rejectOmittedReference(script.graph.context, node.text, script.path);
  inspectStaticImport(script, node);
  if (ts.isImportEqualsDeclaration(node))
    script.graph.context.failClosed(`unsupported import-equals loader ${script.path}`);
  inspectModuleCall(script, node);
  inspectHostLoaderAccess(script, node);
  inspectNewExpression(script, node);
}

function verifyOpaqueContracts(script) {
  const { path, tree, source, flags } = script;
  if (flags.opaqueHostGlobal) {
    const normalized = ts
      .createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
      .printFile(tree);
    if (sha256(normalized) !== REVIEWED_HOST_GLOBAL_SYNTAX[path])
      script.graph.context.failClosed(
        `unreviewed aliased/cast/reflected host-global contract ${path}`,
      );
  }
  if (flags.opaque && sha256(source) !== REVIEWED[path])
    script.graph.context.failClosed(`unreviewed filesystem/host-loader contract ${path}`);
}

async function inspectScript(graph, path) {
  const source = await readGraphSource(graph, path);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  if (tree.parseDiagnostics.length) graph.context.failClosed(`unparseable source ${path}`);
  const script = { graph, path, source, tree, flags: { opaque: false, opaqueHostGlobal: false } };
  function visit(node) {
    inspectScriptNode(script, node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  verifyOpaqueContracts(script);
}

async function consumeGraphModule(graph, path) {
  if (typeof path !== "string" || !graph.context.paths.has(path))
    graph.context.failClosed(`missing Web root ${String(path)}`);
  if (WEB_EXCLUSIONS.includes(path)) graph.context.failClosed(`Web reaches omitted source ${path}`);
  if (graph.seen.has(path)) return;
  await checkPackageScopes(graph, path);
  graph.seen.add(path);
  if (graph.seen.size > WEB_INPUT_POLICY.limits.modules)
    graph.context.failClosed("source graph module cap exceeded");
  if (path.endsWith(".css")) {
    await inspectStylesheet(graph, path);
    return;
  }
  if (SOURCE.test(path) && !path.endsWith(".d.ts")) await inspectScript(graph, path);
}

/**
 * read() uses the caller's bounded no-symlink inventory and race-verified source reader.
 * Configuration, resolution, CSS and AST checks share one source budget and fresh graph.
 */
export async function guardWebInputs({
  root,
  files,
  read,
  helperEntries,
  manifest,
  lock,
  production = manifest.dependencies ?? {},
  fail,
}) {
  const context = createGuardContext({
    root,
    files,
    read,
    helperEntries,
    manifest,
    lock,
    production,
    fail,
  });
  checkConfigurationTopology(context);
  const options = await reviewedResolverOptions(context);
  const profile = await reviewedNextProfile(context);
  await checkPostcssConfiguration(context, profile);
  if (manifest.dependencies?.next !== undefined || !profile.empty) {
    await checkFrameworkPatches(context);
    checkLockedToolchain(context);
  }
  const graph = createGraph(context, options, webRoots(context, profile));
  while (graph.pending.length) await consumeGraphModule(graph, graph.pending.pop());
  return [...graph.seen].sort();
}
