"use client";
import { useSearchParams } from "next/navigation";
import { InboxWorkspace } from "@/features/email/InboxWorkspace";
import type { FolderKey } from "@/features/email/inboxFolders";
import { inboxHref, readInboxLocation } from "@/features/email/inboxLocation";

export function InboxListClient({
  selfActorId,
}: {
  selfActorId: string;
  folder: FolderKey;
}): React.ReactNode {
  const params = useSearchParams();
  const location = readInboxLocation(params);
  return (
    <InboxWorkspace
      selfActorId={selfActorId}
      location={location}
      onNavigate={(next, replace = false) => {
        // Native history updates the App Router's search params without replacing the list subtree.
        const method = replace ? "replaceState" : "pushState";
        window.history[method](null, "", inboxHref(next));
      }}
    />
  );
}
