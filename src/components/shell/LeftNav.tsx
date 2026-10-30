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
  return (
    <>
      <aside
        className={styles.sidebar}
        data-sidebar-state={sidebar.expanded ? "expanded" : "collapsed"}
      >
        <SidebarChrome expanded={sidebar.expanded} onToggle={sidebar.toggle} />
        <SidebarMenu expanded={sidebar.expanded} />
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
            <SidebarChrome expanded mobile onToggle={sidebar.toggle} onNavigate={closeMobile} />
            <SidebarMenu expanded mobile onNavigate={closeMobile} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
