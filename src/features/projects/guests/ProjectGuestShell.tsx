"use client";

import { Folders, LogOut } from "lucide-react";
import Link from "next/link";
import { createContext, type ReactNode, useContext } from "react";
import { ActionErrorProvider } from "@/components/shell/ActionErrorProvider";
import { CsrfRefresher } from "@/components/shell/CsrfRefresher";
import { Button } from "@/components/ui/Button";
import { useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { NativeActorProvider } from "@/features/identity/NativeActorProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { projectsTranslator } from "../ui/projectMessages";

const GuestShell = createContext(false);
export const useProjectGuestShell = () => useContext(GuestShell);

export function ProjectGuestShell({
  guest,
  hasCsrf,
  children,
}: {
  guest: { id: string; name: string };
  hasCsrf: boolean;
  children: ReactNode;
}) {
  const { account } = useMessages();
  const labels = projectsTranslator(useLocale());
  return (
    <NativeActorProvider actorId={guest.id} key={guest.id}>
      <GuestShell.Provider value>
        <ActionErrorProvider>
          <CsrfRefresher hasCsrf={hasCsrf} />
          <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2.5 sm:px-6">
            <Link
              href="/projects/internal"
              className="flex items-center gap-2 rounded text-sm font-medium"
            >
              <Folders className="size-4 text-primary" aria-hidden="true" />
              {labels("index.title")}
            </Link>
            <div className="flex items-center gap-3">
              <bdi className="text-sm text-muted-foreground">{guest.name}</bdi>
              <form
                action="/auth/logout"
                method="post"
                onSubmit={(event) => {
                  const field = event.currentTarget.elements.namedItem("csrfToken");
                  if (field instanceof HTMLInputElement) field.value = readCsrfToken() ?? "";
                }}
              >
                <input type="hidden" name="csrfToken" />
                <Button variant="ghost" size="sm" type="submit">
                  <LogOut aria-hidden="true" className="size-4" />
                  {account.logout}
                </Button>
              </form>
            </div>
          </header>
          <main data-app-content className="min-w-0 p-4 sm:p-6">
            {children}
          </main>
        </ActionErrorProvider>
      </GuestShell.Provider>
    </NativeActorProvider>
  );
}
