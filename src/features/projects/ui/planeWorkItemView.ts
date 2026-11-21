/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane Community v1.5.0
 * apps/web/components/issues/issue-layouts/filters/header/layout-selection.tsx.
 */

const layouts = ["list", "board", "calendar", "gantt_chart", "spreadsheet", "members"] as const;
export type ProjectView = (typeof layouts)[number];
export type ProjectWorkspaceLocation = { view: ProjectView; itemId: string | null };

export function resolveProjectView(value: string | null): ProjectView {
  if (value === "kanban") return "board";
  return layouts.find((layout) => layout === value) ?? "list";
}

export function handleLayoutChange(
  layoutKey: string | null,
  selectedLayout: ProjectView,
  onChange: (layout: ProjectView) => void,
) {
  const layout = layouts.find((candidate) => candidate === layoutKey);
  if (layout !== undefined && selectedLayout !== layout) onChange(layout);
}
