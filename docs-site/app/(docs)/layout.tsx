import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import Image from "next/image";
import type { ReactNode } from "react";
import { REPOSITORY_URL, WEBSITE_URL } from "@/lib/site";
import { source } from "@/lib/source";

export default function PublicDocsLayout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        mode: "top",
        title: (
          <>
            <Image src="/img/logo.png" alt="" width={28} height={28} />
            <span>Warpdrive</span>
          </>
        ),
      }}
      links={[
        { text: "Docs", url: "/" },
        { text: "Website", url: WEBSITE_URL, external: true },
        { text: "GitHub", url: REPOSITORY_URL, external: true },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
