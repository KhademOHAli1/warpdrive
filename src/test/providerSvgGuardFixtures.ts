import { SVG_NAMESPACE, type SvgGuardCode, XLINK_NAMESPACE } from "./providerSvgGuardModels";

export const SVG_PATH = '<path d="M0 0h1v1z" fill="#000000"/>';
export function svgFixture(body = SVG_PATH, rootAttributes = ""): string {
  return `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 24 24" ${rootAttributes}><title>Fixture</title>${body}</svg>`;
}

export const LOCAL_GRADIENT =
  '<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#000000"/><stop offset="100%" stop-color="#FFFFFF"/></linearGradient></defs>';
export const GRADIENT_PATH = '<path d="M0 0h1v1z" fill="url(#g)"/>';

interface AdversarialCase {
  id: string;
  source: string;
  code: SvgGuardCode;
}

export const ADVERSARIAL_SVGS: AdversarialCase[] = [
  {
    id: "A-01 mouse event",
    source: svgFixture(SVG_PATH, 'onmouseover="alert(1)"'),
    code: "attribute",
  },
  {
    id: "A-02 spaced event",
    source: svgFixture(SVG_PATH, 'onload = "alert(1)"'),
    code: "attribute",
  },
  {
    id: "A-03 descendant event",
    source: svgFixture('<path d="M0 0h1v1z" onclick="alert(1)"/>'),
    code: "attribute",
  },
  {
    id: "A-04 prefixed script",
    source: svgFixture(`<s:script xmlns:s="${SVG_NAMESPACE}">alert(1)</s:script>`),
    code: "element",
  },
  {
    id: "A-05 prefixed foreign content",
    source: svgFixture(
      `<s:foreignObject xmlns:s="${SVG_NAMESPACE}"><div xmlns="http://www.w3.org/1999/xhtml">x</div></s:foreignObject>`,
    ),
    code: "element",
  },
  {
    id: "A-06 animation",
    source: svgFixture('<animate attributeName="fill" values="#000000;#FFFFFF" dur="1s"/>'),
    code: "element",
  },
  {
    id: "A-07 mutation",
    source: svgFixture('<set attributeName="fill" to="url(//asset.invalid/x.svg)"/>'),
    code: "element",
  },
  {
    id: "A-08 script link",
    source: svgFixture(`<a href="javascript:alert(1)">${SVG_PATH}</a>`),
    code: "element",
  },
  {
    id: "A-09 remote image",
    source: svgFixture('<image href="//asset.invalid/x.svg"/>'),
    code: "element",
  },
  {
    id: "A-10 embedded use",
    source: svgFixture('<use href="data:image/svg+xml,%3Csvg%2F%3E"/>'),
    code: "element",
  },
  {
    id: "A-11 encoded href",
    source: svgFixture(
      '<path d="M0 0h1v1z" xlink:href="&#x68;ttps://asset.invalid/x.svg"/>',
      `xmlns:xlink="${XLINK_NAMESPACE}"`,
    ),
    code: "attribute",
  },
  {
    id: "A-12 remote paint",
    source: svgFixture('<path d="M0 0h1v1z" fill="url(https://asset.invalid/x.svg#g)"/>'),
    code: "paint",
  },
  {
    id: "A-13 relative remote paint",
    source: svgFixture('<path d="M0 0h1v1z" fill="url(//asset.invalid/x.svg#g)"/>'),
    code: "paint",
  },
  {
    id: "A-14 embedded paint",
    source: svgFixture('<path d="M0 0h1v1z" fill="url(data:image/svg+xml,%3Csvg%2F%3E)"/>'),
    code: "paint",
  },
  {
    id: "A-15 decoded paint",
    source: svgFixture('<path d="M0 0h1v1z" fill="url(&#x68;ttps://asset.invalid/x.svg#g)"/>'),
    code: "paint",
  },
  {
    id: "A-16 style element",
    source: svgFixture(`<style>@import url(//asset.invalid/x.css);</style>${SVG_PATH}`),
    code: "element",
  },
  {
    id: "A-17 inline style",
    source: svgFixture(SVG_PATH, 'style="background-image:url(//asset.invalid/x.svg)"'),
    code: "attribute",
  },
  {
    id: "A-18 stylesheet instruction",
    source: `<?xml-stylesheet href="//asset.invalid/x.css" type="text/css"?>${svgFixture()}`,
    code: "declaration",
  },
  {
    id: "A-19 external DTD",
    source: `<!DOCTYPE svg SYSTEM "https://asset.invalid/x.dtd">${svgFixture()}`,
    code: "declaration",
  },
  {
    id: "A-20 internal entity",
    source: `<!DOCTYPE svg [<!ENTITY x "expanded">]><svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 24 24"><title>&x;</title>${SVG_PATH}</svg>`,
    code: "declaration",
  },
  {
    id: "A-21 filesystem entity",
    source: `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///nonexistent-provider-fixture">]><svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 24 24"><title>&x;</title>${SVG_PATH}</svg>`,
    code: "declaration",
  },
  {
    id: "A-22 wrong namespace",
    source:
      '<svg xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 24 24"><title>Fixture</title></svg>',
    code: "namespace",
  },
  {
    id: "A-23 namespaced paint",
    source: svgFixture('<path d="M0 0h1v1z" p:fill="#000000"/>', 'xmlns:p="urn:unexpected"'),
    code: "attribute",
  },
  {
    id: "A-24 nested viewport",
    source: svgFixture(`<svg viewBox="0 0 24 24">${SVG_PATH}</svg>`),
    code: "structure",
  },
  {
    id: "A-25 infinite viewBox",
    source: `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 Infinity 24"><title>Fixture</title>${SVG_PATH}</svg>`,
    code: "viewbox",
  },
  {
    id: "A-26 duplicate IDs",
    source: svgFixture(`<defs><linearGradient id="g"/><linearGradient id="g"/></defs>${SVG_PATH}`),
    code: "reference",
  },
  {
    id: "A-27 missing gradient",
    source: svgFixture('<path d="M0 0h1v1z" fill="url(#missing)"/>'),
    code: "reference",
  },
  {
    id: "A-28 non-gradient ID",
    source: svgFixture(`<g id="g">${SVG_PATH}</g>${GRADIENT_PATH}`),
    code: "attribute",
  },
  {
    id: "A-29 malformed XML",
    source: `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 24 24"><title>Fixture</title><path></svg>`,
    code: "xml_invalid",
  },
  { id: "A-30 multiple roots", source: svgFixture() + svgFixture(), code: "xml_invalid" },
  {
    id: "A-31 unsupported metadata",
    source: svgFixture(`<metadata>unneeded</metadata>${SVG_PATH}`),
    code: "element",
  },
  {
    id: "A-32 comment viewBox",
    source: `<svg xmlns="${SVG_NAMESPACE}"><!--viewBox="0 0 24 24"--><title>Fixture</title>${SVG_PATH}</svg>`,
    code: "viewbox",
  },
  {
    id: "A-33 comment title",
    source: `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 24 24"><!--<title>fake</title>-->${SVG_PATH}</svg>`,
    code: "title",
  },
  { id: "A-34 byte bound", source: svgFixture(" ".repeat(16 * 1024)), code: "input_limit" },
  { id: "A-35 node bound", source: svgFixture(SVG_PATH.repeat(257)), code: "tree_limit" },
  {
    id: "A-36 depth bound",
    source: svgFixture("<g>".repeat(16) + SVG_PATH + "</g>".repeat(16)),
    code: "tree_limit",
  },
];

export const POSITIVE_SVGS = [
  { id: "minimal path", source: svgFixture() },
  {
    id: "standard XML declaration",
    source: `<?xml version="1.0" encoding="UTF-8"?>${svgFixture()}`,
  },
  {
    id: "standalone XML declaration",
    source: `<?xml version="1.0" encoding="UTF-8" standalone="no"?>${svgFixture()}`,
  },
  { id: "namespace declaration", source: svgFixture(SVG_PATH, `xmlns:xlink="${XLINK_NAMESPACE}"`) },
  {
    id: "escaped title",
    source: `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 24 24"><title>Fixture &lt;not-script&gt;</title>${SVG_PATH}</svg>`,
  },
  { id: "local gradient", source: svgFixture(LOCAL_GRADIENT + GRADIENT_PATH) },
  { id: "forward gradient reference", source: svgFixture(GRADIENT_PATH + LOCAL_GRADIENT) },
];
