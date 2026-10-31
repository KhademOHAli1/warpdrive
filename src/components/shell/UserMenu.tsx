"use client";
import { ChevronDown, LogOut, Settings, User } from "lucide-react";
import Link from "next/link";
import type React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMessages } from "@/features/i18n/LocaleProvider";
import { AppearanceMenuSection } from "@/features/theme/AppearanceMenuSection";
import { APPEARANCE_DEFAULT, type Appearance } from "@/features/theme/appearance";
import { useAppearanceChoice } from "@/features/theme/useAppearanceChoice";
import { avatarColorClass, initials } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { readCsrfToken } from "@/utils/csrfCookie";
import styles from "./TopBar.module.css";

// Language lives in personal settings. Logout is a CSRF-protected POST; opening or
// prefetching the account menu must never end a session.
export function UserMenu({
  userId,
  userName,
  avatarUrl,
  appearance = APPEARANCE_DEFAULT,
}: {
  userId: string;
  userName?: string;
  // The signed-in user's uploaded photo (users.avatar_url). When set, the button shows the photo
  // instead of the deterministic initials/glyph so a user actually sees the avatar they set.
  avatarUrl?: string | null;
  // The account's stored theme, so the menu opens on the choice already in effect.
  appearance?: Appearance;
}): React.ReactNode {
  const hasPhoto = avatarUrl !== undefined && avatarUrl !== null && avatarUrl !== "";
  const { account } = useMessages();
  // Held here rather than in the menu content, which Radix unmounts on close.
  const appearanceChoice = useAppearanceChoice(appearance);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={account.menu} className={styles.userTrigger}>
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-xs font-semibold",
              // Skip the tinted background when a photo fills the circle.
              hasPhoto
                ? "outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                : avatarColorClass(userName !== undefined && userName !== "" ? userName : userId),
            )}
          >
            {hasPhoto ? (
              // biome-ignore lint/performance/noImgElement: tiny header avatar, next/image not warranted
              <img
                src={avatarUrl}
                alt={userName ?? account.heading}
                className="h-full w-full rounded-full object-cover"
              />
            ) : userName !== undefined && userName !== "" ? (
              initials(userName)
            ) : (
              <User aria-hidden="true" className="h-4 w-4" />
            )}
          </span>
          <ChevronDown aria-hidden="true" className={styles.caret} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        aria-label={account.menu}
        align="end"
        className="w-48 rounded-lg border-border/70 p-1.5 shadow-lg ring-0"
      >
        <DropdownMenuItem asChild className="gap-2.5 rounded-md px-2.5 py-2">
          <Link href="/settings/profile">
            <Settings aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            {account.settings}
          </Link>
        </DropdownMenuItem>
        <form action="/auth/logout" method="post">
          <input type="hidden" name="csrfToken" value={readCsrfToken() ?? ""} />
          <DropdownMenuItem
            asChild
            onSelect={(event) => event.preventDefault()}
            className="gap-2.5 rounded-md px-2.5 py-2 text-muted-foreground"
          >
            <button type="submit" className="w-full">
              <LogOut aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              {account.logout}
            </button>
          </DropdownMenuItem>
        </form>
        <DropdownMenuSeparator className="my-1" />
        <AppearanceMenuSection choice={appearanceChoice} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
