import { ProjectSettingsPage } from "@/features/projects/settings/ProjectSettingsPage";

export default function Page({ params }: { params: Promise<{ projectId: string }> }) {
  return <ProjectSettingsPage params={params} section="states" />;
}
