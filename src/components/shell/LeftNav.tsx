"use client";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MOBILE_SIDEBAR_ID, MOBILE_SIDEBAR_TRIGGER_ID } from "@/constants/nav";
import { useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import styles from "./LeftNav.module.css";
import { SidebarChrome } from "./SidebarChrome";
import { SidebarMenu } from "./SidebarMenu";
import { useSidebar } from "./useSidebar";

export function LeftNav({ initialExpanded = false }: { initialExpanded?: boolean } = {}) {
  const sidebar = useSidebar(initialExpanded);
  const messages = useMessages();
  const rtl = useLocale() === "fa";
  const closeMobile = (): void => sidebar.setMobileOpen(false);
  const closePeek = (): void => sidebar.setPeeking(false);
  const expanded = sidebar.expanded || sidebar.peeking;
  return (
    <>
      <aside
        className={styles.sidebar}
        data-sidebar-state={
          sidebar.expanded ? "expanded" : sidebar.peeking ? "peeking" : "collapsed"
        }
        onPointerLeave={(event) => {
          if (!event.currentTarget.querySelector(":focus-visible")) closePeek();
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) closePeek();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || sidebar.expanded || !sidebar.peeking) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.target instanceof Element) {
            event.target
              .closest("[data-sidebar-branch]")
              ?.querySelector<HTMLButtonElement>("button")
              ?.focus();
          }
          closePeek();
        }}
      >
        <div className={styles.sidebarPanel}>
          <SidebarChrome expanded={expanded} onNavigate={closePeek} />
          <SidebarMenu
            expanded={expanded}
            pinnedExpanded={sidebar.expanded}
            onToggle={sidebar.toggle}
            onNavigate={closePeek}
            onRequestExpand={() => {
              if (!sidebar.expanded) sidebar.setPeeking(true);
            }}
          />
        </div>
      </aside>
      <Sheet open={sidebar.mobileOpen} onOpenChange={sidebar.setMobileOpen}>
        <SheetContent
          id={MOBILE_SIDEBAR_ID}
          side={rtl ? "right" : "left"}
          aria-describedby={undefined}
          className={cn("w-80 max-w-[calc(100vw-32px)]", styles.mobilePanel)}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document
              .getElementById(MOBILE_SIDEBAR_ID)
              ?.querySelector<HTMLButtonElement>('[data-slot="sheet-close"]')
              ?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById(MOBILE_SIDEBAR_TRIGGER_ID)?.focus();
          }}
        >
          <SheetTitle className="sr-only">{messages.navigation.primary}</SheetTitle>
          <div className={styles.mobileContents} data-sidebar-state="expanded">
            <SidebarChrome expanded onNavigate={closeMobile} />
            <SidebarMenu expanded mobile onNavigate={closeMobile} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
