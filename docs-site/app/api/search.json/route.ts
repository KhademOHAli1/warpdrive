import { createFromSource } from "fumadocs-core/search/server";
import { publicDocPath } from "@/lib/site";
import { source } from "@/lib/source";

export const dynamic = "force-static";
export const { staticGET: GET } = createFromSource(source, {
  buildIndex(page) {
    const url = publicDocPath(page.url);
    return {
      title: page.data.title,
      description: page.data.description,
      url,
      id: url,
      structuredData: page.data.structuredData,
    };
  },
});
