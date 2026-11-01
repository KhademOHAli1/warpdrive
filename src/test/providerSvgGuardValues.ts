import {
  LOCAL_PAINT,
  SVG_ID,
  SVG_NAMESPACE,
  type SvgGuardCode,
  XLINK_NAMESPACE,
  XMLNS_NAMESPACE,
} from "./providerSvgGuardModels";

const ATTRIBUTES: Record<string, readonly string[]> = {
  svg: ["fill", "height", "preserveAspectRatio", "role", "version", "viewBox", "width"],
  title: [],
  g: ["fill"],
  path: ["d", "fill"],
  polygon: ["points", "fill"],
  defs: [],
  linearGradient: ["id", "x1", "x2", "y1", "y2"],
  stop: ["offset", "stop-color"],
};
const HEX_COLOR = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/;

function finite(value: string): boolean {
  return NUMBER.test(value) && Number.isFinite(Number(value));
}

function viewBox(value: string): boolean {
  const parts = value.trim().split(/[\s,]+/);
  return parts.length === 4 && parts.every(finite) && Number(parts[2]) > 0 && Number(parts[3]) > 0;
}

function coordinate(value: string): boolean {
  return finite(value.endsWith("%") ? value.slice(0, -1) : value);
}

function offset(value: string): boolean {
  const percentage = value.endsWith("%");
  const number = percentage ? value.slice(0, -1) : value;
  return finite(number) && Number(number) >= 0 && Number(number) <= (percentage ? 100 : 1);
}

function paintIssue(name: string, value: string): SvgGuardCode | null {
  switch (name) {
    case "fill":
      return HEX_COLOR.test(value) || LOCAL_PAINT.test(value) ? null : "paint";
    case "stop-color":
      return HEX_COLOR.test(value) ? null : "paint";
    default:
      return "attribute";
  }
}

function dimensionIssue(value: string): SvgGuardCode | null {
  const number = value.endsWith("px") ? value.slice(0, -2) : value;
  return finite(number) && Number(number) > 0 ? null : "attribute";
}

function geometryIssue(name: string, value: string): SvgGuardCode | null {
  switch (name) {
    case "viewBox":
      return viewBox(value) ? null : "viewbox";
    case "width":
    case "height":
      return dimensionIssue(value);
    case "d":
      return value.trim() !== "" && PATH_DATA.test(value) ? null : "attribute";
    case "points": {
      const parts = value.trim().split(/[\s,]+/);
      return parts.length >= 4 && parts.length % 2 === 0 && parts.every(finite)
        ? null
        : "attribute";
    }
    default:
      return "attribute";
  }
}

function metadataIssue(name: string, value: string): SvgGuardCode | null {
  switch (name) {
    case "role":
      return value === "img" ? null : "attribute";
    case "version":
      return value === "1.1" ? null : "attribute";
    case "preserveAspectRatio":
      return value === "xMidYMid" ? null : "attribute";
    default:
      return "attribute";
  }
}

function gradientIssue(name: string, value: string): SvgGuardCode | null {
  switch (name) {
    case "id":
      return SVG_ID.test(value) ? null : "reference";
    case "offset":
      return offset(value) ? null : "attribute";
    case "x1":
    case "x2":
    case "y1":
    case "y2":
      return coordinate(value) ? null : "attribute";
    default:
      return "attribute";
  }
}

function valueIssue(name: string, value: string): SvgGuardCode | null {
  switch (name) {
    case "fill":
    case "stop-color":
      return paintIssue(name, value);
    case "viewBox":
    case "width":
    case "height":
    case "d":
    case "points":
      return geometryIssue(name, value);
    case "role":
    case "version":
    case "preserveAspectRatio":
      return metadataIssue(name, value);
    case "id":
    case "offset":
    case "x1":
    case "x2":
    case "y1":
    case "y2":
      return gradientIssue(name, value);
    default:
      return "attribute";
  }
}

function namespaceDeclaration(attribute: Attr, isRoot: boolean): boolean {
  return (
    isRoot &&
    ((attribute.name === "xmlns" && attribute.value === SVG_NAMESPACE) ||
      (attribute.name === "xmlns:xlink" && attribute.value === XLINK_NAMESPACE))
  );
}

export function svgAttributeIssue(element: Element, root: Element): SvgGuardCode | null {
  const allowed = ATTRIBUTES[element.localName] ?? [];
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.namespaceURI === XMLNS_NAMESPACE) {
      if (!namespaceDeclaration(attribute, element === root)) return "attribute";
      continue;
    }
    if (attribute.namespaceURI !== null || !allowed.includes(attribute.name)) return "attribute";
    const issue = valueIssue(attribute.name, attribute.value);
    if (issue !== null) return issue;
  }
  return element === root && !element.hasAttribute("viewBox") ? "viewbox" : null;
}
