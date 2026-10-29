import type { ReactNode } from "react";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";

// The notifications settings page is a client component, so its document title
// lives here (server metadata) instead of on the page module.
export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.notifications };
}

export default function NotificationSettingsLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return children;
}
