import { planningViewsPage } from "@/features/projects/planning/PlanningScreens";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  return planningViewsPage((await params).projectId);
}
