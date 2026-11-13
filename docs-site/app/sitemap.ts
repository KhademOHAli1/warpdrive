import type { MetadataRoute } from "next";
import { DOCS_ORIGIN, publicDocPath } from "@/lib/site";
import { source } from "@/lib/source";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({ url: new URL(publicDocPath(page.url), DOCS_ORIGIN).href }));
}
