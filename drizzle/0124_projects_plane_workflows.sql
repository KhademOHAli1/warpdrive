CREATE SEQUENCE "public"."internal_project_identifier_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 999999999 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "internal_project_document_presence" (
	"document_id" uuid NOT NULL,
	"client_id" bigint NOT NULL,
	"session_id" uuid NOT NULL,
	"epoch" bigint NOT NULL,
	"cursor" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "internal_project_document_presence_document_id_client_id_pk" PRIMARY KEY("document_id","client_id"),
	CONSTRAINT "internal_project_document_presence_client_id_check" CHECK ("internal_project_document_presence"."client_id" BETWEEN 0 AND 4294967295),
	CONSTRAINT "internal_project_document_presence_epoch_check" CHECK ("internal_project_document_presence"."epoch" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "internal_project_document_presence_cursor_check" CHECK (pg_column_size("internal_project_document_presence"."cursor") <= 512)
);
--> statement-breakpoint
CREATE TABLE "internal_project_planning_assignments" (
	"group_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "internal_project_planning_assignments_group_id_item_id_pk" PRIMARY KEY("group_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "internal_project_planning_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"module_status" text,
	"archived_at" timestamp with time zone,
	"revision" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "internal_project_planning_group_scope_key" UNIQUE("id","kind","project_id"),
	CONSTRAINT "internal_project_planning_groups_kind_check" CHECK (
    ("internal_project_planning_groups"."kind" = 'cycles' AND "internal_project_planning_groups"."module_status" IS NULL AND ("internal_project_planning_groups"."start_date" IS NULL) = ("internal_project_planning_groups"."end_date" IS NULL))
    OR ("internal_project_planning_groups"."kind" = 'modules' AND "internal_project_planning_groups"."module_status" IS NOT NULL AND "internal_project_planning_groups"."module_status" IN ('backlog','planned','in-progress','paused','completed','cancelled'))
  ),
	CONSTRAINT "internal_project_planning_groups_title_check" CHECK (public.agency_project_title_valid("internal_project_planning_groups"."title")),
	CONSTRAINT "internal_project_planning_groups_details_check" CHECK (char_length("internal_project_planning_groups"."description") <= 4000 AND "internal_project_planning_groups"."revision" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "internal_project_planning_groups_dates_check" CHECK ("internal_project_planning_groups"."start_date" IS NULL OR "internal_project_planning_groups"."end_date" IS NULL OR "internal_project_planning_groups"."start_date" <= "internal_project_planning_groups"."end_date")
);
--> statement-breakpoint
CREATE TABLE "internal_project_saved_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"layout" text NOT NULL,
	"visibility" text NOT NULL,
	"filters" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"revision" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "internal_project_saved_views_title_check" CHECK (public.agency_project_title_valid("internal_project_saved_views"."title")),
	CONSTRAINT "internal_project_saved_views_details_check" CHECK (char_length("internal_project_saved_views"."description") <= 4000 AND "internal_project_saved_views"."revision" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "internal_project_saved_views_layout_check" CHECK ("internal_project_saved_views"."layout" IN ('list','board','calendar','gantt_chart','spreadsheet') AND "internal_project_saved_views"."visibility" IN ('project','private') AND jsonb_typeof("internal_project_saved_views"."filters") = 'object')
);
--> statement-breakpoint
CREATE TABLE "internal_project_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"creation_title" text,
	"lead_user_id" uuid,
	"default_assignee_id" uuid,
	"last_item_sequence" bigint DEFAULT 0 NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "internal_project_settings_identifier_key" UNIQUE("identifier"),
	CONSTRAINT "internal_project_settings_identifier_check" CHECK ("internal_project_settings"."identifier" ~ '^[A-Z0-9]{1,10}$'),
	CONSTRAINT "internal_project_settings_sequence_check" CHECK ("internal_project_settings"."last_item_sequence" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "internal_project_settings_description_check" CHECK (char_length("internal_project_settings"."description") <= 10000),
	CONSTRAINT "internal_project_settings_creation_title_check" CHECK ("internal_project_settings"."creation_title" IS NULL OR public.agency_project_title_valid("internal_project_settings"."creation_title")),
	CONSTRAINT "internal_project_settings_revision_check" CHECK ("internal_project_settings"."revision" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "internal_project_states" (
	"project_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"position" integer NOT NULL,
	"color" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "internal_project_states_pkey" PRIMARY KEY("project_id","id"),
	CONSTRAINT "internal_project_states_name_check" CHECK (char_length(btrim("internal_project_states"."name")) BETWEEN 1 AND 80),
	CONSTRAINT "internal_project_states_category_check" CHECK ("internal_project_states"."category" IN ('backlog', 'unstarted', 'started', 'completed', 'cancelled')),
	CONSTRAINT "internal_project_states_position_check" CHECK ("internal_project_states"."position" BETWEEN 0 AND 49),
	CONSTRAINT "internal_project_states_color_check" CHECK ("internal_project_states"."color" ~ '^#[a-f0-9]{6}$')
);
--> statement-breakpoint
ALTER TABLE "internal_project_documents" ADD COLUMN "collaboration_state" "bytea";--> statement-breakpoint
ALTER TABLE "internal_project_documents" ADD COLUMN "collaboration_epoch" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD COLUMN "state_id" uuid;--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD COLUMN "sequence_number" bigint;--> statement-breakpoint
ALTER TABLE "internal_project_document_presence" ADD CONSTRAINT "internal_project_document_presence_document_id_internal_project_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."internal_project_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_document_presence" ADD CONSTRAINT "internal_project_document_presence_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_planning_assignments" ADD CONSTRAINT "internal_project_planning_assignments_group_fkey" FOREIGN KEY ("group_id","kind","project_id") REFERENCES "public"."internal_project_planning_groups"("id","kind","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD CONSTRAINT "internal_project_items_id_project_key" UNIQUE("id","project_id");--> statement-breakpoint
ALTER TABLE "internal_project_planning_assignments" ADD CONSTRAINT "internal_project_planning_assignments_item_fkey" FOREIGN KEY ("item_id","project_id") REFERENCES "public"."internal_project_items"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_planning_groups" ADD CONSTRAINT "internal_project_planning_groups_project_id_agency_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_saved_views" ADD CONSTRAINT "internal_project_saved_views_project_id_agency_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_saved_views" ADD CONSTRAINT "internal_project_saved_views_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_settings" ADD CONSTRAINT "internal_project_settings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_settings" ADD CONSTRAINT "internal_project_settings_lead_fkey" FOREIGN KEY ("lead_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_settings" ADD CONSTRAINT "internal_project_settings_default_assignee_fkey" FOREIGN KEY ("default_assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_states" ADD CONSTRAINT "internal_project_states_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_project_document_presence_expiry_idx" ON "internal_project_document_presence" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "internal_project_document_presence_session_idx" ON "internal_project_document_presence" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "internal_project_planning_assignments_item_idx" ON "internal_project_planning_assignments" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_project_planning_one_cycle_per_item" ON "internal_project_planning_assignments" USING btree ("item_id") WHERE "internal_project_planning_assignments"."kind" = 'cycles';--> statement-breakpoint
CREATE INDEX "internal_project_planning_groups_project_idx" ON "internal_project_planning_groups" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "internal_project_saved_views_project_idx" ON "internal_project_saved_views" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "internal_project_saved_views_owner_idx" ON "internal_project_saved_views" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD CONSTRAINT "internal_project_items_project_state_fkey" FOREIGN KEY ("project_id","state_id") REFERENCES "public"."internal_project_states"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_project_items_state_idx" ON "internal_project_items" USING btree ("project_id","state_id");--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD CONSTRAINT "internal_project_items_project_sequence_key" UNIQUE("project_id","sequence_number");--> statement-breakpoint
ALTER TABLE "internal_project_documents" ADD CONSTRAINT "internal_project_documents_collaboration_state_check" CHECK (octet_length("internal_project_documents"."collaboration_state") <= 1048576);--> statement-breakpoint
ALTER TABLE "internal_project_documents" ADD CONSTRAINT "internal_project_documents_collaboration_epoch_check" CHECK ("internal_project_documents"."collaboration_epoch" BETWEEN 0 AND 9007199254740991);--> statement-breakpoint
-- Preserve the identity, status bucket, and revision of every existing work item.
INSERT INTO public.internal_project_states(project_id, name, category, position, color, is_default)
SELECT project.id, seed.name, seed.category, 0, seed.color, seed.is_default
FROM public.agency_projects AS project
CROSS JOIN (VALUES
  ('To do', 'unstarted', '#60646c', true),
  ('In progress', 'started', '#f59e0b', false),
  ('Done', 'completed', '#46a758', false)
) AS seed(name, category, color, is_default)
WHERE project.kind = 'internal';
--> statement-breakpoint
UPDATE public.internal_project_items AS item
SET state_id = state.id
FROM public.internal_project_states AS state
WHERE state.project_id = item.project_id
  AND state.category = CASE item.status
    WHEN 'done' THEN 'completed' WHEN 'in-progress' THEN 'started' ELSE 'unstarted' END;
--> statement-breakpoint
-- Give existing projects and items stable keys without changing their IDs or revisions.
INSERT INTO public.internal_project_settings(project_id, identifier, creation_title)
SELECT id, 'P' || nextval('public.internal_project_identifier_seq'::regclass), title
FROM public.agency_projects
WHERE kind = 'internal'
ORDER BY created_at, id;
--> statement-breakpoint
WITH item_numbers AS (
  SELECT item.id, row_number() OVER (PARTITION BY item.project_id ORDER BY item.created_at, item.id) AS item_number
  FROM public.internal_project_items AS item
  JOIN public.internal_project_settings AS settings ON item.project_id = settings.project_id
)
UPDATE public.internal_project_items AS item
SET sequence_number = item_numbers.item_number
FROM item_numbers
WHERE item.id = item_numbers.id;
--> statement-breakpoint
UPDATE public.internal_project_settings AS settings
SET last_item_sequence = item_numbers.last_number
FROM (
  SELECT project_id, max(sequence_number) AS last_number
  FROM public.internal_project_items
  GROUP BY project_id
) AS item_numbers
WHERE item_numbers.project_id = settings.project_id;
--> statement-breakpoint
-- The old schema allowed out-of-band rows under client projects. Retain such rows
-- without assigning internal keys, and enforce both checks for new and updated rows.
ALTER TABLE "internal_project_items" ADD CONSTRAINT "internal_project_items_state_required_check" CHECK ("internal_project_items"."state_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD CONSTRAINT "internal_project_items_sequence_check" CHECK ("internal_project_items"."sequence_number" IS NOT NULL AND "internal_project_items"."sequence_number" BETWEEN 1 AND 9007199254740991) NOT VALID;
--> statement-breakpoint
CREATE FUNCTION public.internal_project_seed_workflow() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $body$
BEGIN
  LOOP
    INSERT INTO public.internal_project_settings(project_id, identifier, creation_title)
    VALUES (NEW.id, 'P' || nextval('public.internal_project_identifier_seq'::regclass), NEW.title)
    ON CONFLICT (identifier) DO NOTHING;
    EXIT WHEN FOUND;
  END LOOP;

  INSERT INTO public.internal_project_states(project_id, name, category, position, color, is_default)
  VALUES
    (NEW.id, 'To do', 'unstarted', 0, '#60646c', true),
    (NEW.id, 'In progress', 'started', 0, '#f59e0b', false),
    (NEW.id, 'Done', 'completed', 0, '#46a758', false);
  RETURN NEW;
END;
$body$;
--> statement-breakpoint
CREATE TRIGGER internal_project_seed_workflow
AFTER INSERT ON public.agency_projects
FOR EACH ROW WHEN (NEW.kind = 'internal')
EXECUTE FUNCTION public.internal_project_seed_workflow();
--> statement-breakpoint
CREATE FUNCTION public.internal_project_supply_item_defaults() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $body$
BEGIN
  IF NEW.sequence_number IS NULL THEN
    UPDATE public.internal_project_settings
    SET last_item_sequence = last_item_sequence + 1
    WHERE project_id = NEW.project_id
    RETURNING last_item_sequence INTO NEW.sequence_number;
  END IF;

  IF NEW.state_id IS NULL THEN
    SELECT state.id INTO NEW.state_id
    FROM public.internal_project_states AS state
    WHERE state.project_id = NEW.project_id
      AND CASE NEW.status
        WHEN 'done' THEN state.category IN ('completed', 'cancelled')
        WHEN 'in-progress' THEN state.category = 'started'
        ELSE state.category IN ('backlog', 'unstarted')
      END
    ORDER BY state.is_default DESC, state.position, state.id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$body$;
--> statement-breakpoint
CREATE TRIGGER internal_project_supply_item_defaults
BEFORE INSERT ON public.internal_project_items
FOR EACH ROW WHEN (NEW.state_id IS NULL OR NEW.sequence_number IS NULL)
EXECUTE FUNCTION public.internal_project_supply_item_defaults();
