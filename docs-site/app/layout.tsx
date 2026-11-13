import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { DocsProviders } from "@/components/docs-providers";
import { ProductionAnalytics } from "@/components/production-analytics";
import { SiteFooter } from "@/components/site-footer";
import { DOCS_ORIGIN, SITE_DESCRIPTION } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(DOCS_ORIGIN),
  title: { default: "Warpdrive documentation", template: "%s | Warpdrive" },
  description: SITE_DESCRIPTION,
  icons: { icon: "/img/favicon.ico" },
  openGraph: { type: "website", siteName: "Warpdrive", images: ["/img/logo.png"] },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="warpdrive-docs flex min-h-screen flex-col">
        <DocsProviders>{children}</DocsProviders>
        <SiteFooter />
        <Suspense fallback={null}>
          <ProductionAnalytics />
        </Suspense>
      </body>
    </html>
  );
}
