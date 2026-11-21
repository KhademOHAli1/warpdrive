import { sanitize } from "isomorphic-dompurify";

// Retained HTML can be rendered without fetching external resources on open.
export function projectDocumentHtml(html: string): string {
  return sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "strong",
      "em",
      "b",
      "i",
      "s",
      "u",
      "hr",
      "a",
    ],
    ALLOWED_ATTR: ["href", "title", "start", "rel"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/(?![\\/]))/i,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
