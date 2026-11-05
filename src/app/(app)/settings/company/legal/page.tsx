import { redirect } from "next/navigation";
import { createContext } from "@/server/trpc/context";
import { LegalClient } from "./LegalClient";
export default async function LegalPage() {
  const { actor } = await createContext();
  if (actor === null) redirect("/login");
  return <LegalClient actorId={actor.id} />;
}
