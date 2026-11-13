import type { Item, Node } from "fumadocs-core/page-tree";
import { DOCS_ORIGIN, publicDocPath, SITE_DESCRIPTION, WEBSITE_URL } from "@/lib/site";
import { source } from "@/lib/source";

export const dynamic = "force-static";

function pageLine(item: Item) {
  const page = source.getNodePage(item);
  if (!page) return "";
  const description = page.data.description?.replace(/\s+/g, " ").trim();
  return `- [${page.data.title}](${DOCS_ORIGIN}${publicDocPath(page.url)})${description ? `: ${description}` : ""}`;
}

function sectionLines(nodes: Node[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === "separator") return [];
    if (node.type === "page") return [pageLine(node)];
    return ["", `## ${node.name}`, "", ...sectionLines(node.children)];
  });
}

export function GET() {
  const introduction = source.getPage([]);
  const description = introduction?.data.description ?? SITE_DESCRIPTION;
  const overview = source.pageTree.children.filter((node) => node.type === "page");
  const sections = source.pageTree.children.filter((node) => node.type === "folder");

  return new Response(
    [
      "# Warpdrive documentation",
      "",
      `> ${description}`,
      "",
      `Product site: ${WEBSITE_URL} (overview at ${WEBSITE_URL}/llms.txt)`,
      "",
      "## Getting started",
      "",
      ...sectionLines(overview),
      ...sectionLines(sections),
      "",
    ].join("\n"),
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
