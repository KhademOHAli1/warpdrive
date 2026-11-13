import { pageSchema } from "fumadocs-core/source/schema";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { z } from "zod";

export const docs = defineDocs({
  dir: "docs",
  docs: {
    schema: pageSchema.extend({ slug: z.literal("/").optional() }),
  },
});

export default defineConfig({
  mdxOptions: {
    // Keep the established /img URLs and derive dimensions from local public files.
    remarkImageOptions: { useImport: false, external: false },
  },
});
