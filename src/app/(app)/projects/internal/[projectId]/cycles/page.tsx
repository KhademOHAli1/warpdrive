import { planningGroupsPage } from "@/features/projects/planning/PlanningScreens";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  return planningGroupsPage((await params).projectId, "cycles");
}
