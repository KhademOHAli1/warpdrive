import {
  BookOpen,
  Briefcase,
  ChartNoAxesColumn,
  Code,
  Flag,
  FolderKanban,
  Globe,
  Heart,
  Layers,
  Lightbulb,
  Package,
  Palette,
  Rocket,
  Shield,
  Sparkles,
  Target,
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { ProjectBrandIcon, ProjectCover, ProjectCoverPreset, ProjectLogo } from "./contracts";

const icons = {
  folder: FolderKanban,
  rocket: Rocket,
  sparkles: Sparkles,
  briefcase: Briefcase,
  target: Target,
  layers: Layers,
  flag: Flag,
  globe: Globe,
  code: Code,
  palette: Palette,
  chart: ChartNoAxesColumn,
  book: BookOpen,
  heart: Heart,
  lightbulb: Lightbulb,
  package: Package,
  shield: Shield,
} satisfies Record<ProjectBrandIcon, typeof FolderKanban>;

const presets: Record<ProjectCoverPreset, string> = {
  aurora: "bg-[linear-gradient(115deg,#052e2b,#14765f,#70a443)]",
  dusk: "bg-[linear-gradient(115deg,#322a46,#885763,#d1915e)]",
  ocean: "bg-[linear-gradient(115deg,#162b50,#285c9c,#51aaa9)]",
  orchid: "bg-[linear-gradient(115deg,#321a59,#654298,#ae6595)]",
};

export function ProjectBrandMark({
  logo,
  className,
}: {
  logo?: ProjectLogo | null;
  className?: string;
}) {
  const Icon = logo?.kind === "icon" ? icons[logo.value] : FolderKanban;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-md border border-border/60 bg-card text-primary",
        className,
      )}
    >
      {logo?.kind === "emoji" ? (
        <span className="text-lg">{logo.value}</span>
      ) : (
        <Icon
          className="size-4"
          style={logo?.kind === "icon" ? { color: logo.color } : undefined}
        />
      )}
    </span>
  );
}

export function ProjectCoverArt({
  cover,
  imageSrc,
  className,
}: {
  cover?: ProjectCover | null;
  imageSrc?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden bg-muted/55",
        cover?.kind === "preset" && presets[cover.value],
        className,
      )}
    >
      {imageSrc !== undefined && (
        <Image alt="" className="object-cover" src={imageSrc} fill unoptimized />
      )}
    </div>
  );
}
