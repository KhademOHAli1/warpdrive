import { Mail } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./NavIcons.module.css";

// Finance OS geometry plus CRM-specific symbols drawn to its 1.5px rounded outline style.
const bounds = {
  "pipeline-board": [21.5, 21.5],
  "lead-person-plus": [21.5, 21.5],
  "performance-bars": [21.5, 21.5],
  "settings-cog": [21.5, 21.5],
  "guide-open-book": [21.5, 21.5],
  "user-group": [21.4998, 21.5],
  "folder-open": [21.5, 19.5001],
  "calendar-01": [19.5, 21.5],
  "chevron-left": [7.5, 13.5],
  "chevron-right": [7.5, 13.5],
  "chevron-down": [13.5, 7.5],
  bars: [21.5, 13.5],
} as const;

type IconProps = { className?: string; size?: number };
const NAV_ICON_CLASS = "h-[18px] w-[18px] shrink-0";

export function FinanceNavGlyph({
  name,
  size = 20,
  className,
  mirror = true,
}: IconProps & {
  name: keyof typeof bounds;
  mirror?: boolean;
}): ReactNode {
  const [width, height] = bounds[name];
  const style = {
    "--nav-icon-url": `url("/finance-os-icons/${name}.svg")`,
    "--nav-icon-width": `${(size * width) / 24}px`,
    "--nav-icon-height": `${(size * height) / 24}px`,
    width: size,
    height: size,
  } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      data-finance-icon={name}
      data-rtl-mirror={mirror ? undefined : "false"}
      className={cn(styles.icon, className)}
      style={style}
    />
  );
}

function NavIcon({
  name,
  className,
  size = 18,
}: IconProps & { name: keyof typeof bounds }): ReactNode {
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
