// This only decides whether an editor note has content. HTML is sanitized on write.
// Keep the scan small enough to run in both the browser and server, and treat
// malformed markup as content so clearing a note cannot silently lose text.
const CONTENT_ELEMENTS = new Set(["img", "hr", "video", "iframe", "audio", "embed", "object"]);

function isAsciiLetter(char: string | undefined): boolean {
  return char !== undefined && /^[a-z]$/i.test(char);
}

function isNameChar(char: string | undefined): boolean {
  return char !== undefined && /^[a-z0-9:-]$/i.test(char);
}

function readTag(
  html: string,
  start: number,
): { end: number; name: string; closing: boolean } | null {
  let i = start + 1;
  const closing = html[i] === "/";
  if (closing) i++;
  if (!isAsciiLetter(html[i])) return null;

  const nameStart = i;
  while (isNameChar(html[i])) i++;
  const name = html.slice(nameStart, i).toLowerCase();
  if (html[i] !== ">" && html[i] !== "/" && html[i]?.trim() !== "") return null;

  let quote: '"' | "'" | null = null;
  for (; i < html.length; i++) {
    const char = html[i];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "<") {
      return null;
    } else if (char === ">") {
      return { end: i + 1, name, closing };
    }
  }
  return null;
}

function isBlankText(html: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    if (html[i] === "&") {
      const entity = html.slice(i, Math.min(i + 6, to)).toLowerCase();
      if (entity === "&nbsp;" || entity === "&#160;" || entity === "&#xa0;") {
        i += entity.length - 1;
        continue;
      }
    }
    if (html[i]?.trim() !== "") return false;
  }
  return true;
}

// RichTextBody emits markup like "<p></p>" or "<p><br></p>" when cleared.
export function isBlankHtml(html: string): boolean {
  let i = 0;
  while (i < html.length) {
    const tagStart = html.indexOf("<", i);
    if (tagStart === -1) return isBlankText(html, i, html.length);
    if (!isBlankText(html, i, tagStart)) return false;

    if (html.startsWith("<!--", tagStart)) {
      const end = html.indexOf("-->", tagStart + 4);
      if (end === -1) return false;
      i = end + 3;
      continue;
    }

    const tag = readTag(html, tagStart);
    if (tag === null) return false;
    if (!tag.closing && CONTENT_ELEMENTS.has(tag.name)) return false;
    i = tag.end;
  }
  return true;
}
