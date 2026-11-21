/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane Community v1.5.0, packages/constants/src/estimates.ts.
 */
import type { ProjectEstimateType } from "./contracts";

export const projectEstimatePresets = [
  { id: "fibonacci", type: "points", values: ["1", "2", "3", "5", "8", "13"] },
  { id: "linear", type: "points", values: ["1", "2", "3", "4", "5", "6"] },
  { id: "squares", type: "points", values: ["1", "4", "9", "16", "25", "36"] },
  { id: "tShirt", type: "categories", values: ["XS", "S", "M", "L", "XL", "XXL"] },
  { id: "difficulty", type: "categories", values: ["Easy", "Medium", "Hard", "Very Hard"] },
] as const satisfies readonly {
  id: string;
  type: ProjectEstimateType;
  values: readonly string[];
}[];
