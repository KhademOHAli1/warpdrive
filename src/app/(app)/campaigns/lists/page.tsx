import { notFound } from "next/navigation";
import { ListsScreen } from "@/features/newsletter/audience/ListsScreen";
import { hasNewsletterPermission } from "@/features/newsletter/permissions";
import { createContext } from "@/server/trpc/context";

export default async function ListsPage() {
  const { actor } = await createContext();
  if (!hasNewsletterPermission(actor, "operate")) notFound();
  return <ListsScreen />;
}
