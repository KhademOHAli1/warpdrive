export const projectLabelKinds = ["group", "label"] as const;
export const projectEstimateTypes = ["points", "categories"] as const;
export const projectLabelsMaxCount = 100;
export const projectEstimateScalesMaxCount = 20;
export const projectEstimatePointMinCount = 2;
export const projectEstimatePointMaxCount = 6;
export const projectEstimatePointMaxLength = 20;
export const projectWorkStructureNameMaxLength = 80;
export const projectWorkStructureDescriptionMaxLength = 2000;

export type ProjectLabelKind = (typeof projectLabelKinds)[number];
export type ProjectEstimateType = (typeof projectEstimateTypes)[number];

export type ProjectLabel = {
  id: string;
  name: string;
  description: string;
  color: string;
  kind: ProjectLabelKind;
  parentId: string | null;
  position: number;
};

export type ProjectEstimatePoint = {
  id: string;
  value: string;
  description: string;
  position: number;
};

export type ProjectEstimateScale = {
  id: string;
  name: string;
  type: ProjectEstimateType;
  points: ProjectEstimatePoint[];
};

export type ProjectWorkStructure = {
  revision: number;
  labels: ProjectLabel[];
  scales: ProjectEstimateScale[];
  activeScaleId: string | null;
};

export type ProjectItemStructure = { labelIds: string[]; estimatePointId: string | null };
export type ProjectItemStructurePatch = Partial<ProjectItemStructure>;

type StructureTarget = { projectId: string; revision: number };
export type SaveProjectLabels = StructureTarget & { labels: ProjectLabel[] };
export type SaveProjectEstimateScale = StructureTarget & {
  scaleId: string;
  scale: Omit<ProjectEstimateScale, "id"> | null;
  replacements?: { pointId: string; replacementPointId: string }[];
};
export type SetProjectEstimateScale = StructureTarget & { scaleId: string | null };

export const emptyProjectWorkStructure: ProjectWorkStructure = {
  revision: 0,
  labels: [],
  scales: [],
  activeScaleId: null,
};

export const emptyProjectItemStructure: ProjectItemStructure = {
  labelIds: [],
  estimatePointId: null,
};
