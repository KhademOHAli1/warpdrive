import { DocsBody, DocsPage, EditOnGitHub } from "fumadocs-ui/layouts/notebook/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicDocPath, REPOSITORY_URL } from "@/lib/site";
import { source } from "@/lib/source";
import { useMDXComponents } from "@/mdx-components";

interface DocPageProps {
  params: Promise<{ slug?: string[] }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: DocPageProps): Promise<Metadata> {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  const url = publicDocPath(page.url);
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: url },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url,
      siteName: "Warpdrive",
      images: ["/img/logo.png"],
    },
  };
}

export default async function PublicDoc({ params }: DocPageProps) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  const Content = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsBody>
        <Content components={useMDXComponents({ a: createRelativeLink(source, page) })} />
      </DocsBody>
      <EditOnGitHub href={`${REPOSITORY_URL}/edit/main/docs-site/docs/${page.path}`} />
    </DocsPage>
  );
}
