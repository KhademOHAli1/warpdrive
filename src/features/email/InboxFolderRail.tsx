"use client";
import { Archive, Inbox, type LucideIcon, Pencil, Send, SendHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type React from "react";
import { Tip } from "@/components/ui/tooltip";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { cn } from "@/lib/utils";
import { FOLDER_KEYS, type FolderKey, parseFolder } from "./inboxFolders";

const COMPOSE_PATH = "/inbox/compose";

// The rail lives in the persistent /inbox layout, so it reads the active state straight from the
// router (it never remounts on navigation). Compose highlights the New email action; a reader route
// (/inbox/<threadId>) keeps Inbox lit; the list route reflects its ?folder= param.
function deriveActive(
  pathname: string,
  params: URLSearchParams,
): { folder: FolderKey | null; composeActive: boolean } {
  if (pathname === COMPOSE_PATH) return { folder: null, composeActive: true };
  if (pathname.startsWith("/inbox/")) return { folder: "inbox", composeActive: false };
  return { folder: parseFolder(params.get("folder")), composeActive: false };
}

const ICONS: Record<FolderKey, LucideIcon> = {
  inbox: Inbox,
  drafts: Pencil,
  outbox: SendHorizontal,
  sent: Send,
  archive: Archive,
};

const NEW_EMAIL_BUTTON_CLASSES =
  "mb-2 flex items-center justify-center gap-2 rounded-md bg-action px-3 py-2 text-sm font-medium text-action-foreground transition-transform active:scale-[0.96]";

export function InboxFolderRail({
  newEmailEnabled,
  hideComposeOnList = false,
}: {
  newEmailEnabled: boolean;
  hideComposeOnList?: boolean;
}): React.ReactNode {
  const E = useEmailMessages();
  const format = useFormatters();

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { folder: activeFolder, composeActive } = deriveActive(pathname, searchParams);
  const unreadCount = trpc.email.inbox.unreadCount.useQuery().data ?? 0;
  return (
    <nav
      aria-label={E._extra.mail_folders}
      className="flex h-full w-full min-w-0 flex-col gap-1 border-e p-3"
    >
      {/* A disabled Link has no real-world meaning (it would still be clickable), so the
          no-mailbox state renders a genuinely inert disabled button instead of a navigable
          link; only the enabled state navigates to the full-pane compose route. */}
      {hideComposeOnList && pathname === "/inbox" ? null : newEmailEnabled ? (
        <Tip label={E._extra.compose_a_new_email}>
          <Link
            href="/inbox/compose"
            aria-current={composeActive ? "page" : undefined}
            className={cn(
              NEW_EMAIL_BUTTON_CLASSES,
              composeActive && "ring-2 ring-ring ring-offset-1",
            )}
          >
            <span aria-hidden="true">+</span> {E.composeTitle}
          </Link>
        </Tip>
      ) : (
        <Tip label={E._extra.compose_needs_a_connected_mailbox}>
          <button
            type="button"
            disabled
            className={cn(NEW_EMAIL_BUTTON_CLASSES, "cursor-not-allowed opacity-60")}
          >
            <span aria-hidden="true">+</span> {E.composeTitle}
          </button>
        </Tip>
      )}

      {FOLDER_KEYS.map((key) => {
        const Glyph = ICONS[key];
        return (
          <Link
            key={key}
            href={`/inbox?folder=${key}`}
            onClick={(event) => {
              if (
                pathname !== "/inbox" ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              window.history.pushState(null, "", `/inbox?folder=${key}`);
            }}
            aria-current={activeFolder === key ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm",
              activeFolder === key
                ? "bg-accent font-medium text-accent-foreground"
                : "text-foreground hover:bg-accent",
            )}
          >
            <Glyph aria-hidden="true" className="h-4 w-4" />
            <span>{E._folders[key]}</span>
            {key === "inbox" && unreadCount > 0 && (
              <span className="ms-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground tabular-nums">
                {format.number(unreadCount)}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
