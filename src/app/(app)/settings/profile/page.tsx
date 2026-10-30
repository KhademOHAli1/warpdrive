import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { ProfileClient } from "./ProfileClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L._hierarchy.profile };
}

// Identity only. Regional formats, display, and workflow preferences have separate destinations.
export default async function ProfilePage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const { actor } = await createContext();
  if (actor === null) return <p className="text-sm text-red-600">{L.requiresAuth}</p>;

  const [me] = await db
    .select({ name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, actor.id));

  return (
    <SettingsPage>
      <SettingsHeading
        title={L._hierarchy.profile}
        description={L._hierarchy.profileDescription}
        scope="personal"
      />
      <ProfileClient
        name={me?.name ?? ""}
        email={me?.email ?? ""}
        avatarUrl={me?.avatarUrl ?? null}
      />
    </SettingsPage>
  );
}
