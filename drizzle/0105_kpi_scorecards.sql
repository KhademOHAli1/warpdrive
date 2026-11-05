CREATE TABLE "kpi_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_definition_positive_revision" CHECK ("kpi_definitions"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "kpi_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"scheme_id" uuid,
	"assignment" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kpi_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"value" numeric(18, 4) NOT NULL,
	"measured_on" date NOT NULL,
	"source_note" text NOT NULL,
	"sample_size" integer,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_measurement_source_note" CHECK (length(trim("kpi_measurements"."source_note"))>=5),
	CONSTRAINT "kpi_measurement_sample_size" CHECK ("kpi_measurements"."sample_size">0)
);
--> statement-breakpoint
CREATE TABLE "kpi_schemes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_scheme_positive_revision" CHECK ("kpi_schemes"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "kpi_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"viewer_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_snapshot_period" CHECK ("kpi_snapshots"."period_end">="kpi_snapshots"."period_start")
);
--> statement-breakpoint
ALTER TABLE "kpi_definitions" ADD CONSTRAINT "kpi_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_goals" ADD CONSTRAINT "kpi_goals_definition_id_kpi_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."kpi_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_goals" ADD CONSTRAINT "kpi_goals_scheme_id_kpi_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."kpi_schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_goals" ADD CONSTRAINT "kpi_goals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_measurements" ADD CONSTRAINT "kpi_measurements_goal_id_kpi_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."kpi_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_measurements" ADD CONSTRAINT "kpi_measurements_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_schemes" ADD CONSTRAINT "kpi_schemes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_goal_id_kpi_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."kpi_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_viewer_id_users_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_definition_revision_idx" ON "kpi_definitions" USING btree ("family_id","revision");--> statement-breakpoint
CREATE INDEX "kpi_goal_definition_idx" ON "kpi_goals" USING btree ("definition_id");--> statement-breakpoint
CREATE INDEX "kpi_measurement_goal_date_idx" ON "kpi_measurements" USING btree ("goal_id","measured_on");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_scheme_revision_idx" ON "kpi_schemes" USING btree ("family_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_snapshot_viewer_period_idx" ON "kpi_snapshots" USING btree ("goal_id","viewer_id","period_start","period_end");
--> statement-breakpoint
CREATE FUNCTION warpdrive_kpi_immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'KPI revisions and observations are append-only; publish a new revision';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER kpi_definition_immutable BEFORE UPDATE OR DELETE ON kpi_definitions
  FOR EACH ROW EXECUTE FUNCTION warpdrive_kpi_immutable_revision();
--> statement-breakpoint
CREATE TRIGGER kpi_scheme_immutable BEFORE UPDATE OR DELETE ON kpi_schemes
  FOR EACH ROW EXECUTE FUNCTION warpdrive_kpi_immutable_revision();
--> statement-breakpoint
CREATE TRIGGER kpi_measurement_immutable BEFORE UPDATE OR DELETE ON kpi_measurements
  FOR EACH ROW EXECUTE FUNCTION warpdrive_kpi_immutable_revision();
--> statement-breakpoint
CREATE TRIGGER kpi_snapshot_immutable BEFORE UPDATE OR DELETE ON kpi_snapshots
  FOR EACH ROW EXECUTE FUNCTION warpdrive_kpi_immutable_revision();

--> statement-breakpoint
CREATE FUNCTION warpdrive_kpi_pinned_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.definition_id IS DISTINCT FROM NEW.definition_id
     OR OLD.scheme_id IS DISTINCT FROM NEW.scheme_id
     OR OLD.assignment IS DISTINCT FROM NEW.assignment
     OR OLD.created_by IS DISTINCT FROM NEW.created_by
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'KPI assignments pin their definition and target; create a new assignment';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER kpi_goal_pinned BEFORE UPDATE ON kpi_goals
  FOR EACH ROW EXECUTE FUNCTION warpdrive_kpi_pinned_assignment();
