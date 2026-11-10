import { type SQL, sql } from "drizzle-orm";
import { dealVisibilityPredicate } from "@/features/permissions/sql";
import type { ProjectListReadContext } from "./projectListTypes";

export function projectListVisibility(context: ProjectListReadContext): SQL {
  const visibility = context.crmVisibility;
  const deal = dealVisibilityPredicate(visibility, {
    ownerId: sql`d.owner_id`,
    visibilityLevel: sql`d.visibility_level`,
    visibilityGroupId: sql`d.visibility_group_id`,
    visibleToUserIds: sql`d.visible_to_user_ids`,
    pipelineVisibilityGroupId: sql`pipe.visibility_group_id`,
  });
  const person = dealVisibilityPredicate(visibility, {
    ownerId: sql`pe.owner_id`,
    visibilityLevel: sql`pe.visibility_level`,
    visibilityGroupId: sql`pe.visibility_group_id`,
    visibleToUserIds: sql`pe.visible_to_user_ids`,
    pipelineVisibilityGroupId: sql`NULL::uuid`,
  });
  const organization = dealVisibilityPredicate(visibility, {
    ownerId: sql`org.owner_id`,
    visibilityLevel: sql`org.visibility_level`,
    visibilityGroupId: sql`org.visibility_group_id`,
    visibleToUserIds: sql`org.visible_to_user_ids`,
    pipelineVisibilityGroupId: sql`NULL::uuid`,
  });

  // CRM's native administrator rule never skips local project membership or Privacy ceilings.
  // Every explicit link is independently required; EXISTS cannot multiply project rows.
  return sql`
    (project.owner_user_id=${context.actor.id}::uuid OR EXISTS (
      SELECT 1 FROM agency_project_members member
      WHERE member.project_id=project.id AND member.user_id=${context.actor.id}::uuid
    ))
    AND (project.deal_id IS NULL OR EXISTS (
      SELECT 1 FROM deals d JOIN pipelines pipe ON pipe.id=d.pipeline_id
      WHERE d.id=project.deal_id AND d.deleted_at IS NULL
        AND pipe.is_archived=false AND ${deal}
    ))
    AND (project.person_id IS NULL OR EXISTS (
      SELECT 1 FROM persons pe
      WHERE pe.id=project.person_id AND pe.deleted_at IS NULL AND ${person}
    ))
    AND (project.org_id IS NULL OR EXISTS (
      SELECT 1 FROM organizations org
      WHERE org.id=project.org_id AND org.deleted_at IS NULL AND ${organization}
    ))
    AND (${context.privacyCeiling})`;
}
