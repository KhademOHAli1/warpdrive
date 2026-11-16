import { cache } from "react";
import type { CustomFieldTarget } from "@/constants/customFieldTypes";
import { getBootstrap } from "./context";
import { coreClient } from "./trpc";

export async function getPreferencesForActor() {
  const bootstrap = await getBootstrap();
  return bootstrap.shell?.prefs ?? coreClient().frontend.preferences.query();
}
export async function readBaseCurrency() {
  const bootstrap = await getBootstrap();
  return bootstrap.shell?.baseCurrency ?? coreClient().frontend.baseCurrency.query();
}
export const listDefs = (target: CustomFieldTarget) =>
  coreClient().customFields.listDefs.query({ target });
export const listHiddenBuiltins = cache(() => coreClient().frontend.hiddenBuiltins.query());
export const listAssignableUsers = () => coreClient().identity.assignableUsers.query();
export const listUsers = () => coreClient().identity.listUsers.query();
export const listPermissionSets = () => coreClient().identity.listPermissionSets.query();
export const listTeams = () => coreClient().identity.listTeams.query();
export const listVisibilityGroups = () => coreClient().identity.listVisibilityGroups.query();
export const listTeamMembers = (id: string) => coreClient().frontend.teamMembers.query({ id });
export const listGroupMembers = (id: string) => coreClient().frontend.groupMembers.query({ id });
export const listLabels = () => coreClient().frontend.labels.query();
export const listLostReasons = () => coreClient().frontend.lostReasons.query();
export const listTypes = () => coreClient().frontend.activityTypes.query();
export const loadDashboardConfig = () => coreClient().frontend.dashboardConfiguration.query();
export const projectLanding = () => coreClient().frontend.projectsLanding.query();
export const getActorMailbox = () => coreClient().frontend.mailbox.query();
export const listActorMailboxes = () => coreClient().frontend.mailboxes.query();
export const readWorkflowRuntime = () => coreClient().frontend.workflowRuntime.query();
export const listLifecyclePipelines = () => coreClient().frontend.lifecyclePipelines.query();
export const getConnections = cache(() => coreClient().frontend.connections.query());
export const getPersonDetail = cache((id: string) =>
  coreClient().frontend.personDetail.query({ id }),
);
export const getOrgDetail = cache((id: string) => coreClient().frontend.orgDetail.query({ id }));
export const getLeadDetail = cache((id: string) => coreClient().frontend.leadDetail.query({ id }));
export const getDealDetail = cache((id: string) => coreClient().frontend.dealDetail.query({ id }));
export const calendarRange = (range: { from: Date; to: Date }, timeZone: string) =>
  coreClient().activities.calendarRange.query({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    timeZone,
  });
