export type SvgGuardCode =
  | "input_limit"
  | "declaration"
  | "xml_invalid"
  | "namespace"
  | "element"
  | "structure"
  | "attribute"
  | "paint"
  | "reference"
  | "title"
  | "viewbox"
  | "tree_limit";

export interface SvgGuardIssue {
  code: SvgGuardCode;
}

export interface SvgGuardSummary {
  elementCount: number;
  gradientIds: string[];
}

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
export const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
export const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
export const SVG_ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
export const LOCAL_PAINT = /^url\(#([A-Za-z_][A-Za-z0-9_.-]*)\)$/;
