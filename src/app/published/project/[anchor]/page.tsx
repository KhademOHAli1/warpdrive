import type { Metadata } from "next";
import { PublishedProjectPage } from "@/features/projects/publication/PublishedProjectPage";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default PublishedProjectPage;
