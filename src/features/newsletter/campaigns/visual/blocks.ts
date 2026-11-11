import { z } from "zod";

export const blockTypes = ["heading", "paragraph", "button", "image", "divider"] as const;
export type BlockType = (typeof blockTypes)[number];
export const maxVisualBlocks = 24;

const block = z.strictObject({
  id: z.uuid(),
  type: z.enum(blockTypes),
  text: z.string().max(1500),
  url: z.string().max(1000),
});
export type VisualBlock = z.infer<typeof block>;

const layout = z.strictObject({
  format: z.literal("warpdrive-newsletter-blocks-v1"),
  blocks: z.array(block).max(maxVisualBlocks),
});

export function readVisualBlocks(source: string, currentBody: string): VisualBlock[] | null {
  if (source === "" && currentBody === "") return [];
  try {
    const parsed = layout.safeParse(JSON.parse(source));
    if (!parsed.success) return null;
    const ids = new Set(parsed.data.blocks.map((entry) => entry.id));
    return ids.size === parsed.data.blocks.length ? parsed.data.blocks : null;
  } catch {
    return null;
  }
}

export function serializeVisualBlocks(blocks: VisualBlock[]): string {
  return JSON.stringify({ format: "warpdrive-newsletter-blocks-v1", blocks });
}

const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "{": "&#123;",
  "}": "&#125;",
};
function escapeMarkup(value: string): string {
  return value.replace(/[&<>"'{}]/g, (match) => entities[match] ?? "");
}

function secureUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      ? escapeMarkup(url.href)
      : null;
  } catch {
    return null;
  }
}

function renderBlock(block: VisualBlock): string {
  const text = escapeMarkup(block.text);
  switch (block.type) {
    case "heading":
      return `<h2 style="margin:0 0 16px;color:#19222f;font-size:24px;line-height:1.25">${text}</h2>`;
    case "paragraph":
      return `<p style="margin:0 0 16px;line-height:1.55">${text.replace(/\r?\n/g, "<br>")}</p>`;
    case "button": {
      const url = secureUrl(block.url);
      return url === null
        ? ""
        : `<p style="margin:0 0 18px"><a href="${url}" style="display:inline-block;padding:10px 18px;background:#245cbd;color:#fff;border-radius:4px;text-decoration:none">${text}</a></p>`;
    }
    case "image": {
      const url = secureUrl(block.url);
      return url === null
        ? ""
        : `<p style="margin:0 0 16px"><img src="${url}" alt="${text}" style="display:block;max-width:100%;height:auto"></p>`;
    }
    case "divider":
      return '<hr style="margin:22px 0;border:0;border-top:1px solid #d9dee6">';
  }
}

export function renderVisualBlocks(blocks: VisualBlock[], unsubscribe: string): string {
  const content = blocks.map(renderBlock).join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#fff;color:#263241;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="100%" style="max-width:620px"><tr><td dir="auto">${content}<p style="margin:24px 0 0;font-size:12px"><a href="{{ UnsubscribeURL }}">${escapeMarkup(unsubscribe)}</a></p>{{ TrackView }}</td></tr></table></td></tr></table></body></html>`;
}
