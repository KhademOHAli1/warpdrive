import { redirect } from "next/navigation";
import { createContext } from "@/server/trpc/context";
import { WorkClient } from "./WorkClient";
export default async function WorkPage() {
  const { actor } = await createContext();
  if (actor === null) redirect("/login");
  return <WorkClient actorId={actor.id} />;
}
