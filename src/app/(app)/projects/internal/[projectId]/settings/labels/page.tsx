import { WorkStructurePage } from "@/features/projects/work-structure/WorkStructurePage";

export default function Page({ params }: { params: Promise<{ projectId: string }> }) {
  return <WorkStructurePage params={params} section="labels" />;
}
