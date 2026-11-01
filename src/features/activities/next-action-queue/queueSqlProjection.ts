import { type SQL, sql } from "drizzle-orm";

// These aliases are fixed by queueSql, never supplied by a request.
function contact(alias: "pe" | "o" | "l", label: "name" | "title"): SQL {
  const column = (name: string) => sql.raw(`${alias}.${name}`);
  return sql`case when ${column("id")} is null then null else jsonb_build_object(
    'id', ${column("id")}, 'label', ${column(label)}, 'ownerId', ${column("owner_id")},
    'visibilityLevel', ${column("visibility_level")},
    'visibilityGroupId', ${column("visibility_group_id")},
    'visibleToUserIds', ${column("visible_to_user_ids")}
  ) end`;
}

const DEAL_PARENT = sql`case when d.id is null then null else jsonb_build_object(
  'id', d.id, 'label', d.title, 'ownerId', d.owner_id,
  'visibilityLevel', d.visibility_level, 'visibilityGroupId', d.visibility_group_id,
  'visibleToUserIds', d.visible_to_user_ids,
  'pipelineVisibilityGroupId', p.visibility_group_id, 'pipelineArchived', p.is_archived
) end`;

export function activityQueuePayload(): SQL {
  return sql`jsonb_build_object(
    'kind', 'activity', 'id', a.id, 'title', a.subject,
    'dueAt', a.due_at, 'endAt', a.end_at, 'allDay', a.all_day,
    'dueDate', a.due_date, 'endDate', a.end_date,
    'assigneeId', a.assignee_id, 'assigneeName', coalesce(au.name, ''),
    'dealId', a.deal_id, 'personId', a.person_id, 'orgId', a.org_id,
    'deal', ${DEAL_PARENT}, 'person', ${contact("pe", "name")},
    'organization', ${contact("o", "name")}, 'lead', ${contact("l", "title")},
    'participants', coalesce((
      select jsonb_agg(ap.user_id order by ap.user_id)
      from activity_participants ap where ap.activity_id = a.id
    ), '[]'::jsonb)
  )`;
}

export function dealQueuePayload(): SQL {
  return sql`jsonb_build_object(
    'kind', 'deal', 'id', d.id, 'title', d.title,
    'ownerId', d.owner_id, 'ownerName', coalesce(ou.name, ''),
    'pipeline', jsonb_build_object('id', p.id, 'label', p.name),
    'lastActivityAt', d.last_activity_at, 'createdAt', d.created_at,
    'person', ${contact("pe", "name")}, 'organization', ${contact("o", "name")}
  )`;
}
