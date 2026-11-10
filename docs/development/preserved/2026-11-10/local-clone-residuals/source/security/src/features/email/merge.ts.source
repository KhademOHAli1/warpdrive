const TOKEN = /\{\{([^{}]*?)\}\}/g;
const BARE_TOKEN = /^[\w.]+$/;
const INLINE_TAGS = new Set([
  "a",
  "b",
  "code",
  "del",
  "em",
  "font",
  "i",
  "mark",
  "s",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "u",
]);

// Tokens can be split by rich-text marks or an editor-generated autolink. Only
// balanced inline markup is ignored; a stray '<' or malformed tag is not a key.
function readInlineTag(
  inner: string,
  start: number,
): { end: number; name: string; closing: boolean } | null {
  let i = start + 1;
  const closing = inner[i] === "/";
  if (closing) i++;
  const nameStart = i;
  if (inner[i] === undefined || !/[a-z]/i.test(inner[i])) return null;
  while (inner[i] !== undefined && /[a-z0-9:-]/i.test(inner[i])) i++;
  const name = inner.slice(nameStart, i).toLowerCase();
  if (!INLINE_TAGS.has(name)) return null;
  const afterName = i;
  if (inner[i] !== ">" && inner[i]?.trim() !== "") return null;

  let quote: '"' | "'" | null = null;
  for (; i < inner.length; i++) {
    const char = inner[i];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "<") {
      return null;
    } else if (char === ">") {
      const tail = inner.slice(afterName, i).trim();
      if ((closing && tail !== "") || (!closing && tail.endsWith("/"))) return null;
      return { end: i + 1, name, closing };
    }
  }
  return null;
}

function tokenKey(inner: string): string | null {
  const openTags: string[] = [];
  let key = "";
  for (let i = 0; i < inner.length; ) {
    if (inner[i] === "<") {
      const tag = readInlineTag(inner, i);
      if (tag === null) return null;
      if (tag.closing) {
        if (openTags.pop() !== tag.name) return null;
      } else {
        openTags.push(tag.name);
      }
      i = tag.end;
    } else {
      const entity = inner.slice(i, i + 6).toLowerCase();
      if (entity === "&nbsp;" || entity === "&#160;" || entity === "&#xa0;") {
        key += " ";
        i += 6;
      } else {
        key += inner[i];
        i++;
      }
    }
  }
  return openTags.length === 0 ? key.trim() : null;
}

export function applyMergeFields(
  template: string,
  ctx: Record<string, string>,
  options?: { keepUnresolved?: boolean },
): string {
  return template.replace(TOKEN, (match, inner: string) => {
    const key = tokenKey(inner);
    if (key === null || !BARE_TOKEN.test(key)) return match;
    if (Object.hasOwn(ctx, key)) {
      const value = ctx[key];
      if (value !== undefined) return value;
    }
    return options?.keepUnresolved === true ? match : "";
  });
}
