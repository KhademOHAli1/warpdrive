import type { MetadataRoute } from "next";
import { DOCS_ORIGIN } from "@/lib/site";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${DOCS_ORIGIN}/sitemap.xml`,
  };
}
