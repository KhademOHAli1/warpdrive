export type WorkflowValue =
  | string
  | number
  | boolean
  | null
  | WorkflowValue[]
  | { [key: string]: WorkflowValue };
export type StepOutput = Record<string, WorkflowValue>;
export type RunOutputs = Record<string, StepOutput>;
