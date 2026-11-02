import { Icon, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FINANCE_NAV_GLYPHS } from "./financeNavGlyphs";
import styles from "./NavIcons.module.css";

type FinanceGlyphName = keyof typeof FINANCE_NAV_GLYPHS;

type IconProps = { className?: string; size?: number };
const NAV_ICON_CLASS = "h-[18px] w-[18px] shrink-0";

export function FinanceNavGlyph({
  name,
  size = 20,
  className,
  mirror = true,
}: IconProps & {
  name: FinanceGlyphName;
  mirror?: boolean;
}): ReactNode {
  const { width, height, node } = FINANCE_NAV_GLYPHS[name];
  return (
    <Icon
      iconNode={node}
      size={size}
      viewBox={`${(width - 24) / 2} ${(height - 24) / 2} 24 24`}
      stroke="none"
      strokeWidth={1.5}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      data-finance-icon={name}
      data-rtl-mirror={mirror ? undefined : "false"}
      className={cn(styles.icon, className)}
      style={{ width: size, height: size }}
    />
  );
}

function NavIcon({
  name,
  className,
  size = 18,
}: IconProps & { name: FinanceGlyphName }): ReactNode {
  return <FinanceNavGlyph name={name} size={size} className={className ?? NAV_ICON_CLASS} />;
}

export function PipelineIcon(props: IconProps): ReactNode {
  return <NavIcon name="pipeline-board" {...props} />;
}
export function LeadsIcon(props: IconProps): ReactNode {
  return <NavIcon name="lead-person-plus" {...props} />;
}
export function ContactsIcon(props: IconProps): ReactNode {
  return <NavIcon name="user-group" {...props} />;
}
export function ActivitiesIcon(props: IconProps): ReactNode {
  return <NavIcon name="calendar-01" {...props} />;
}
export function DashboardIcon(props: IconProps): ReactNode {
  return <NavIcon name="performance-bars" {...props} />;
}
export function SettingsIcon(props: IconProps): ReactNode {
  return <NavIcon name="settings-cog" {...props} />;
}
export function DocsIcon(props: IconProps): ReactNode {
  return <NavIcon name="guide-open-book" {...props} />;
}
export function DealsIcon(props: IconProps): ReactNode {
  return <NavIcon name="folder-open" {...props} />;
}

// Finance OS uses the same Lucide Mail glyph for its mail destination.
export function InboxIcon({ className, size = 18 }: IconProps): ReactNode {
  return (
    <Mail
      aria-hidden="true"
      size={size}
      strokeWidth={1.9}
      className={className ?? NAV_ICON_CLASS}
    />
  );
}
