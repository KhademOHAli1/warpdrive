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

function tagEnd(inner: string, start: number): number | null {
  let quote: '"' | "'" | null = null;
  for (let i = start; i < inner.length; i++) {
    const char = inner[i];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "<") {
      return null;
    } else if (char === ">") {
      return i;
    }
  }
  return null;
}

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
  if (!/[a-z]/i.test(inner.charAt(i))) return null;
  while (/[a-z0-9:-]/i.test(inner.charAt(i))) i++;
  const name = inner.slice(nameStart, i).toLowerCase();
  if (!INLINE_TAGS.has(name)) return null;
  const afterName = i;
  if (inner[i] !== ">" && inner[i]?.trim() !== "") return null;
  const end = tagEnd(inner, i);
  if (end === null) return null;
  const tail = inner.slice(afterName, end).trim();
  if ((closing && tail !== "") || (!closing && tail.endsWith("/"))) return null;
  return { end: end + 1, name, closing };
}

function trackTag(openTags: string[], tag: { name: string; closing: boolean }): boolean {
  if (tag.closing) return openTags.pop() === tag.name;
  openTags.push(tag.name);
  return true;
}

function isNonBreakingSpace(inner: string, index: number): boolean {
  const entity = inner.slice(index, index + 6).toLowerCase();
  return entity === "&nbsp;" || entity === "&#160;" || entity === "&#xa0;";
}

function tokenKey(inner: string): string | null {
  const openTags: string[] = [];
  let key = "";
  for (let i = 0; i < inner.length; ) {
    if (inner[i] === "<") {
      const tag = readInlineTag(inner, i);
      if (tag === null || !trackTag(openTags, tag)) return null;
      i = tag.end;
      continue;
    }
    if (isNonBreakingSpace(inner, i)) {
      key += " ";
      i += 6;
      continue;
    }
    key += inner[i];
    i++;
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
