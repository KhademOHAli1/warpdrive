"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ProjectSummary } from "../contracts";
import type { ProjectSettingsMessages } from "../settings/messages";
import {
  maxProjectCoverUpload,
  type ProjectBrandChange,
  type ProjectCoverPreset,
  type ProjectLogo,
  projectBrandIcons,
  projectCoverPath,
  projectCoverPresets,
} from "./contracts";
import { projectLogoInput } from "./input";
import { ProjectBrandMark, ProjectCoverArt } from "./ProjectBrand";

const suggestedEmoji = ["🚀", "🧭", "✨", "🎯", "📚", "💡", "🏗️", "🌱", "💼", "🎨"] as const;
const zones = ["UTC", ...Intl.supportedValuesOf("timeZone")];

export type CoverDraft =
  | { kind: "existing" }
  | { kind: "preset"; value: ProjectCoverPreset }
  | { kind: "upload"; data: string }
  | { kind: "removed" };

export function projectCoverChange(
  cover: CoverDraft,
): Pick<ProjectBrandChange, "cover" | "coverImage"> {
  switch (cover.kind) {
    case "removed":
      return { cover: null };
    case "preset":
      return { cover };
    case "upload":
      return { coverImage: cover.data.split(",", 2)[1] };
    case "existing":
      return {};
  }
}

export function ProjectBrandFields({
  project,
  logo,
  setLogo,
  cover,
  setCover,
  pending,
  labels,
}: {
  project?: Pick<ProjectSummary, "id" | "cover">;
  logo: ProjectLogo | null;
  setLogo: (logo: ProjectLogo | null) => void;
  cover: CoverDraft;
  setCover: (cover: CoverDraft) => void;
  pending: boolean;
  labels: ProjectSettingsMessages;
}) {
  const id = useId();
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const currentCover =
    cover.kind === "existing" ? project?.cover : cover.kind === "preset" ? cover : null;
  const source =
    cover.kind === "upload"
      ? cover.data
      : currentCover?.kind === "image" && project !== undefined
        ? projectCoverPath(project.id, currentCover.value)
        : undefined;

  function upload(file: File | undefined) {
    if (file === undefined) return;
    setFailed(false);
    if (
      file.size > maxProjectCoverUpload ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      setFailed(true);
      return;
    }
    setReading(true);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setCover({ kind: "upload", data: reader.result });
      setReading(false);
    };
    reader.onerror = () => {
      setReading(false);
      setFailed(true);
    };
    reader.readAsDataURL(file);
  }

  return (
    <fieldset className="grid gap-4" disabled={pending}>
      <legend className="mb-2 text-sm font-medium">{labels.branding}</legend>
      <div className="relative">
        <ProjectCoverArt
          cover={currentCover}
          imageSrc={source}
          className="h-24 rounded-md border sm:h-32"
        />
        <ProjectBrandMark logo={logo} className="absolute bottom-2 start-2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <span className="text-sm font-medium">{labels.logo}</span>
          <Select
            ariaLabel={labels.logo}
            options={[
              { value: "", label: labels.none },
              { value: "emoji", label: labels.emoji },
              { value: "icon", label: labels.icon },
            ]}
            value={logo?.kind ?? ""}
            disabled={pending}
            onChange={(kind) =>
              setLogo(
                kind === "emoji"
                  ? { kind, value: "🚀" }
                  : kind === "icon"
                    ? { kind, value: "folder", color: "#2aab87" }
                    : null,
              )
            }
          />
          {logo?.kind === "emoji" && (
            <>
              <Input
                aria-label={labels.emoji}
                dir="ltr"
                value={logo.value}
                maxLength={32}
                onChange={(event) => setLogo({ kind: "emoji", value: event.target.value })}
                aria-invalid={!projectLogoInput.safeParse(logo).success}
              />
              <div className="flex flex-wrap gap-1">
                {suggestedEmoji.map((emoji) => (
                  <Button
                    key={emoji}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-7"
                    aria-pressed={logo.value === emoji}
                    onClick={() => setLogo({ kind: "emoji", value: emoji })}
                  >
                    {emoji}
                  </Button>
                ))}
              </div>
            </>
          )}
          {logo?.kind === "icon" && (
            <div className="flex gap-2">
              <Select
                ariaLabel={labels.icon}
                options={projectBrandIcons.map((value) => ({ value, label: labels.icons[value] }))}
                value={logo.value}
                disabled={pending}
                onChange={(value) => {
                  const icon = projectBrandIcons.find((candidate) => candidate === value);
                  if (icon) setLogo({ ...logo, value: icon });
                }}
              />
              <Input
                type="color"
                className="w-12 px-1.5 py-1"
                aria-label={labels.iconColor}
                value={logo.color}
                onChange={(event) => setLogo({ ...logo, color: event.target.value })}
              />
            </div>
          )}
        </div>
        <div className="grid content-start gap-2">
          <span className="text-sm font-medium">{labels.cover}</span>
          <Select
            ariaLabel={labels.cover}
            options={[
              { value: "", label: labels.none },
              ...projectCoverPresets.map((value) => ({ value, label: labels.covers[value] })),
              ...(source !== undefined ? [{ value: "image", label: labels.customCover }] : []),
            ]}
            value={source !== undefined ? "image" : (currentCover?.value ?? "")}
            disabled={pending || reading}
            onChange={(value) => {
              if (value === "image") return;
              const preset = projectCoverPresets.find((candidate) => candidate === value);
              setCover(preset ? { kind: "preset", value: preset } : { kind: "removed" });
            }}
          />
          <label htmlFor={`${id}-upload`} className="text-sm text-muted-foreground">
            {labels.uploadCover}
          </label>
          <Input
            id={`${id}-upload`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={reading}
            onChange={(event) => {
              upload(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {labels.invalidCover}
            </p>
          )}
        </div>
      </div>
    </fieldset>
  );
}

export function ProjectTimeZoneField({
  labels,
  value,
  setValue,
  pending,
}: {
  labels: ProjectSettingsMessages;
  value: string;
  setValue: (zone: string) => void;
  pending: boolean;
}) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {labels.timeZone}
      </label>
      <Input
        id={id}
        list={`${id}-zones`}
        dir="ltr"
        value={value}
        disabled={pending}
        required
        onChange={(event) => setValue(event.target.value)}
        aria-describedby={`${id}-help`}
      />
      <datalist id={`${id}-zones`}>
        {zones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <p id={`${id}-help`} className="text-sm text-muted-foreground">
        {labels.timeZoneHelp}
      </p>
    </div>
  );
}
