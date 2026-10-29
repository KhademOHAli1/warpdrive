import type React from "react";
import { Suspense } from "react";
import { getAppTranslations } from "@/features/i18n/server";
import { DetailDrawer } from "@/features/navigation/DetailDrawer";
import { DetailDrawerPreviewSkeleton } from "@/features/navigation/DetailDrawerPreviewSkeleton";
import { DealDetailView } from "../../../../deals/[dealId]/DealDetailView";

// Intercepted deal workspace: a row click in the Activities list opens the deal the activity hangs
// off as a slide-over over the list, with the URL still updating to /deals/[dealId] so a hard load
// renders the full page. Widest of the drawers, because the workspace is a two-column layout.
export default async function InterceptedDealPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}): Promise<React.ReactNode> {
  const { dealId } = await params;
  const t = await getAppTranslations("utilities.drawer");
  return (
    <DetailDrawer
      title={t("deal")}
      contentClassName="w-full sm:w-[96vw] md:w-[92vw] lg:w-[88vw] xl:w-[84vw] max-w-[1600px]"
    >
      <Suspense fallback={<DetailDrawerPreviewSkeleton recordId={dealId} />}>
        <DealDetailView dealId={dealId} />
      </Suspense>
    </DetailDrawer>
  );
}
