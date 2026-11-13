import { DocsBody, DocsPage, DocsTitle } from "fumadocs-ui/layouts/notebook/page";
import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchPage } from "@/components/search-page";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
};

export default function DocumentationSearch() {
  return (
    <DocsPage breadcrumb={{ enabled: false }} footer={{ enabled: false }}>
      <DocsTitle>Search documentation</DocsTitle>
      <DocsBody>
        <Suspense fallback={<p>Loading search…</p>}>
          <SearchPage />
        </Suspense>
      </DocsBody>
    </DocsPage>
  );
}
