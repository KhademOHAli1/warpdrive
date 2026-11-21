import {
  defaultProjectWorkflowStates,
  type ProjectWorkflowState,
  projectStateLegacyStatus,
} from "../contracts";
import type { ProjectsTranslator } from "./projectMessages";

export function workflowStateLabel(state: ProjectWorkflowState, labels: ProjectsTranslator) {
  const standard = defaultProjectWorkflowStates.some(
    ({ category, name }) => category === state.category && name === state.name,
  );
  return standard ? labels(`status.${projectStateLegacyStatus(state.category)}`) : state.name;
}
