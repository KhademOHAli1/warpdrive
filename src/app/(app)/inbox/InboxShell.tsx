import type React from "react";
import { InboxFolderRail } from "@/features/email/InboxFolderRail";
import { InboxMailboxProvider } from "@/features/email/InboxMailboxContext";
import styles from "@/features/email/inboxWorkspace.module.css";

// Persistent inbox frame (Pipedrive Sales Inbox parity): the folder rail sits to the left of the
// route content on every /inbox route. Because this shell renders from the shared inbox layout, the
// rail stays mounted across list -> reader -> compose client navigations (no flash, scroll kept),
// and its active highlight tracks the route via the router hooks it reads internally.
export function InboxShell({
  newEmailEnabled,
  children,
}: {
  newEmailEnabled: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <InboxMailboxProvider value={newEmailEnabled}>
      <div className={styles.shellRoot}>
        <div className={styles.shell}>
          <div className={styles.folders}>
            <InboxFolderRail newEmailEnabled={newEmailEnabled} hideComposeOnList />
          </div>
          <div className={styles.shellContent}>{children}</div>
        </div>
      </div>
    </InboxMailboxProvider>
  );
}
