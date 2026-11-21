import type { ProjectItem } from "../contracts";
import type { ProjectWorkStructure } from "../work-structure/contracts";
import type { ProjectsTranslator } from "./projectMessages";

export function projectLabelOptions(catalog: ProjectWorkStructure) {
  const groups = new Map(
    catalog.labels.filter(({ kind }) => kind === "group").map(({ id, name }) => [id, name]),
  );
  return catalog.labels
    .filter(({ kind }) => kind === "label")
    .map(({ id, name, parentId }) => {
      const group = parentId === null ? undefined : groups.get(parentId);
      return { value: id, label: group === undefined ? name : `${group} › ${name}` };
    });
}

export function ProjectItemStructureBadges({
  item,
  catalog,
  labels,
  showLabels = true,
  showEstimate = true,
}: {
  item: ProjectItem;
  catalog: ProjectWorkStructure;
  labels: ProjectsTranslator;
  showLabels?: boolean;
  showEstimate?: boolean;
}) {
  const tags = showLabels ? catalog.labels.filter(({ id }) => item.labelIds.includes(id)) : [];
  const point = showEstimate
    ? catalog.scales.flatMap(({ points }) => points).find(({ id }) => id === item.estimatePointId)
    : undefined;
  if (tags.length === 0 && point === undefined) return null;
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {tags.map(({ id, name, color }) => (
        <span
          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-muted-foreground"
          key={id}
        >
          <i
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: color }}
          />
          <bdi>{name}</bdi>
        </span>
      ))}
      {point !== undefined && (
        <span className="rounded border px-1.5 py-0.5 text-muted-foreground">
          {labels("workspace.estimate")} <bdi>{point.value}</bdi>
        </span>
      )}
    </div>
  );
}
