"use client";

import { Icon, type LucideIconNode } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import styles from "./LeftNav.module.css";

const panelIcon: LucideIconNode[] = [
  [
    "path",
    {
      d: "M21.25 6.72v10.56a2.97 2.97 0 0 1-2.97 2.97H5.72a2.97 2.97 0 0 1-2.97-2.97V6.72a2.97 2.97 0 0 1 2.97-2.97h12.56a2.97 2.97 0 0 1 2.97 2.97",
      key: "panel",
    },
  ],
  ["path", { d: "M6.25 7.25v9.5", className: styles.sidebarToggleRail, key: "rail" }],
];

export function SidebarToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const t = useAppTranslations("navigation");
  const rtl = useLocale() === "fa";
  const label = t("pinSidebar");
  const tooltip = t(expanded ? "unpinSidebar" : "pinSidebar");
  return (
    <Tip
      label={tooltip}
      side={rtl ? "left" : "right"}
      className={styles.tooltip}
      delayDuration={200}
      sideOffset={8}
    >
      <button
        type="button"
        aria-label={label}
        aria-pressed={expanded}
        aria-controls="primary-navigation"
        className={styles.sidebarToggle}
        onClick={onToggle}
      >
        <Icon
          iconNode={panelIcon}
          size={18}
          strokeWidth={1.5}
          aria-hidden="true"
          focusable="false"
          data-rtl-mirror="true"
        />
      </button>
    </Tip>
  );
}
