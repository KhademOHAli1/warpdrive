import type { ManagementMessages } from "../messages";
import type { ManagementAction } from "../schemas";
export interface ManagementUiProps {
  L: ManagementMessages;
  pending: boolean;
  send: (command: ManagementAction) => Promise<boolean>;
}
export type AskManagementAction = (command: ManagementAction, description?: string) => void;
