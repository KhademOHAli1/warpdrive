/** Inspect exact first-party Web SDK import bindings under a reviewed profile. */
import ts from "typescript";
import controlsPolicy from "./web-sdk-controls-import-policy.json" with { type: "json" };
import policy from "./web-sdk-import-policy.json" with { type: "json" };

function referencesSdk(value) {
  let specifier = value;
  try {
    specifier = decodeURIComponent(value);
  } catch {
    // Malformed escapes still need to be rejected if they name the SDK.
  }
  return /(?:^|\/)@ui-sdk(?:\/|$)/iu.test(specifier.replaceAll("\\", "/"));
}

function admittedExports(specifier, path, version) {
  const { pilot, successor } = policy;
  if (Object.hasOwn(pilot, specifier)) {
    const additional = reviewedEntry(controlsPolicy.additionalBindings, path, version);
    return additional?.specifier === specifier
      ? [...pilot[specifier], ...additional.exports]
      : pilot[specifier];
  }
  if (version >= 2 && path === successor.path && specifier === successor.specifier) {
    return successor.exports;
  }
  const control = reviewedEntry(controlsPolicy.controls, path, version);
  if (control?.specifier === specifier) return control.exports;
  return [];
}

function reviewedEntry(entries, path, version) {
  return version === 3 && Object.hasOwn(entries, path) ? entries[path] : undefined;
}

export function hasReviewedSdkControl(reachable, read) {
  return Object.entries(controlsPolicy.controls).some(([path, { specifier }]) => {
    if (!reachable.includes(path)) return false;
    const tree = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
    return inspectWebSdkImports(tree, path, 3).some((binding) => binding.specifier === specifier);
  });
}

function trackValueExport(node, valueExports) {
  if (ts.isExportSpecifier(node) && !node.isTypeOnly && !node.parent.parent.isTypeOnly) {
    valueExports.add((node.propertyName ?? node.name).text);
  }
  if (ts.isExportAssignment(node) && !node.isExportEquals && ts.isIdentifier(node.expression)) {
    valueExports.add(node.expression.text);
  }
}

/** The caller must independently verify reachability, exact source bytes and package custody. */
export function inspectWebSdkImports(tree, path, version) {
  if (![1, 2, 3].includes(version)) throw new Error("Unknown Web SDK import policy version");
  const reject = () => {
    throw new Error(`Unreviewed Web SDK import in ${path}`);
  };
  if (
    tree.parseDiagnostics.length ||
    [...tree.referencedFiles, ...tree.typeReferenceDirectives].some(({ fileName }) =>
      referencesSdk(fileName),
    )
  ) {
    reject();
  }
  const directive = tree.statements[0];
  const client =
    directive &&
    ts.isExpressionStatement(directive) &&
    ts.isStringLiteral(directive.expression) &&
    directive.expression.text === "use client";
  const imports = [];
  const valueExports = new Set();
  const localNames = new Set();
  const publicNames = new Set();

  function visit(node) {
    for (const doc of node.jsDoc ?? []) visit(doc);
    trackValueExport(node, valueExports);
    if (ts.isStringLiteralLike(node) && referencesSdk(node.text)) {
      const declaration = node.parent;
      const clause = ts.isImportDeclaration(declaration) ? declaration.importClause : undefined;
      const bindings = clause?.namedBindings;
      if (
        !client ||
        !ts.isStringLiteral(node) ||
        node.getText(tree).slice(1, -1) !== node.text ||
        !ts.isImportDeclaration(declaration) ||
        declaration.parent !== tree ||
        declaration.moduleSpecifier !== node ||
        declaration.attributes ||
        !clause ||
        clause.isTypeOnly ||
        clause.name ||
        !bindings ||
        !ts.isNamedImports(bindings) ||
        bindings.elements.length === 0
      ) {
        reject();
        return;
      }
      const allowed = admittedExports(node.text, path, version);
      for (const binding of bindings.elements) {
        const original = binding.propertyName ?? binding.name;
        const local = binding.name.text;
        const publicName = `${node.text}:${original.text}`;
        if (
          binding.isTypeOnly ||
          !ts.isIdentifier(original) ||
          original.getText(tree) !== original.text ||
          !allowed.includes(original.text) ||
          localNames.has(local) ||
          publicNames.has(publicName)
        ) {
          reject();
        }
        localNames.add(local);
        publicNames.add(publicName);
        imports.push({ specifier: node.text, exported: original.text, local });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(tree);
  if (imports.some(({ local }) => valueExports.has(local))) reject();
  const control = reviewedEntry(controlsPolicy.controls, path, version);
  if (control) {
    const selected = imports.filter(({ specifier }) => specifier === control.specifier);
    if (selected.length > 0 && selected.length !== control.exports.length) reject();
  }
  return imports;
}
