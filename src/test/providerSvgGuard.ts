import { Buffer } from "node:buffer";
import { err, ok, type Result } from "@/types/result";
import {
  LOCAL_PAINT,
  SVG_NAMESPACE,
  type SvgGuardCode,
  type SvgGuardIssue,
  type SvgGuardSummary,
} from "./providerSvgGuardModels";
import { svgAttributeIssue } from "./providerSvgGuardValues";

const MAX_SVG_BYTES = 16 * 1024;
const MAX_SVG_NODES = 256;
const MAX_SVG_DEPTH = 16;
const PARSER_ERROR_NAMESPACE = "http://www.mozilla.org/newlayout/xml/parsererror.xml";
const XML_DECLARATIONS = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
];
const CHILDREN: Record<string, readonly string[]> = {
  svg: ["title", "defs", "g", "path"],
  title: [],
  defs: ["linearGradient"],
  linearGradient: ["stop"],
  stop: [],
  g: ["path", "polygon"],
  path: [],
  polygon: [],
};

function refuse(code: SvgGuardCode): { ok: false; error: SvgGuardIssue } {
  return err({ code });
}

function preflight(source: string): SvgGuardCode | null {
  if (source.trim() === "" || Buffer.byteLength(source, "utf8") > MAX_SVG_BYTES)
    return "input_limit";
  // jsdom's XML path handles entity definitions. Refuse declarations before giving it input.
  if (/<\s*!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) return "declaration";
  const declaration = XML_DECLARATIONS.find((value) => source.startsWith(value));
  const body = declaration === undefined ? source : source.slice(declaration.length);
  return body.includes("<?") ? "declaration" : null;
}

function collectNodes(root: Element): Result<Node[], SvgGuardIssue> {
  const nodes: Node[] = [];
  const pending: { node: Node; depth: number }[] = [{ node: root, depth: 1 }];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    const { node, depth } = entry;
    nodes.push(node);
    if (nodes.length > MAX_SVG_NODES || depth > MAX_SVG_DEPTH) return refuse("tree_limit");
    for (const child of Array.from(node.childNodes).reverse()) {
      pending.push({ node: child, depth: depth + (child.nodeType === Node.ELEMENT_NODE ? 1 : 0) });
    }
  }
  return ok(nodes);
}

function elementIssue(element: Element, root: Element): SvgGuardCode | null {
  if (element.namespaceURI !== SVG_NAMESPACE) return "namespace";
  if (!Object.hasOwn(CHILDREN, element.localName)) return "element";
  if (element !== root) {
    const allowed = CHILDREN[element.parentElement?.localName ?? ""] ?? [];
    if (!allowed.includes(element.localName)) return "structure";
  }
  return svgAttributeIssue(element, root);
}

function textIssue(nodes: Node[]): SvgGuardCode | null {
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.COMMENT_NODE) continue;
    if (node.nodeType !== Node.TEXT_NODE) return "structure";
    if (node.parentElement?.localName !== "title" && (node.textContent ?? "").trim() !== "")
      return "structure";
  }
  return null;
}

function validateTree(root: Element, nodes: Node[]): Result<SvgGuardSummary, SvgGuardIssue> {
  const gradients = new Map<string, Element>();
  const references = new Set<string>();
  let elementCount = 0;
  let titles = 0;
  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as Element;
    elementCount++;
    const issue = elementIssue(element, root);
    if (issue !== null) return refuse(issue);
    if (element.localName === "title") {
      titles++;
      if (
        (element.textContent ?? "").trim() === "" ||
        Array.from(element.childNodes).some((child) => child.nodeType !== Node.TEXT_NODE)
      )
        return refuse("title");
    }
    if (element.localName === "linearGradient") {
      const id = element.getAttribute("id");
      if (id === null || gradients.has(id)) return refuse("reference");
      gradients.set(id, element);
    }
    const reference = LOCAL_PAINT.exec(element.getAttribute("fill") ?? "")?.[1];
    if (reference !== undefined) references.add(reference);
  }
  if (titles !== 1) return refuse("title");
  const issue = textIssue(nodes);
  if (issue !== null) return refuse(issue);
  if (Array.from(references).some((id) => !gradients.has(id))) return refuse("reference");
  return ok({ elementCount, gradientIds: Array.from(references).sort() });
}

// Test-time validation of the retained static profile, never a runtime upload sanitizer.
export function validateProviderSvg(source: string): Result<SvgGuardSummary, SvgGuardIssue> {
  const issue = preflight(source);
  if (issue !== null) return refuse(issue);
  let document: Document;
  try {
    document = new DOMParser().parseFromString(source, "image/svg+xml");
  } catch {
    return refuse("xml_invalid");
  }
  if (document.getElementsByTagNameNS(PARSER_ERROR_NAMESPACE, "parsererror").length > 0)
    return refuse("xml_invalid");
  if (document.doctype !== null) return refuse("declaration");
  const root = document.documentElement;
  if (root.namespaceURI !== SVG_NAMESPACE || root.localName !== "svg" || root.prefix !== null)
    return refuse("namespace");
  const nodes = collectNodes(root);
  return nodes.ok ? validateTree(root, nodes.value) : nodes;
}
