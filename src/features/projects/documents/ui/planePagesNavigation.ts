/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane Community v1.5.0, apps/web/app/(all)/[workspaceSlug]/
 * (projects)/projects/(detail)/[projectId]/pages/(list)/page.tsx.
 * Warpdrive resolves project and private visibility at its Core boundary.
 */

export const pageTypes = ["project", "private", "archived"] as const;
export type PageType = (typeof pageTypes)[number];

export const getPageType = (pageType?: string | null): PageType => {
  if (pageType === "private") return "private";
  if (pageType === "archived") return "archived";
  return "project";
};
