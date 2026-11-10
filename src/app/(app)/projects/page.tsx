import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { projectLanding } from "@/features/agency-projects/nativeViews";
import { ProjectsScreen } from "@/features/agency-projects/ProjectsScreen";
import { createContext } from "@/server/trpc/context";

export default async function ProjectsPage() {
  const context = await createContext();
  if (context.session === null) redirect("/login");
  const landing = await projectLanding(db, context.session, AbortSignal.timeout(10_000));
  if (landing === null) redirect("/login");
  return <ProjectsScreen {...landing} />;
}
