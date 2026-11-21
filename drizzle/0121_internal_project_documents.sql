CREATE TABLE "internal_project_document_versions" (
	"document_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"title" text NOT NULL,
	"body_html" text NOT NULL,
	"editor_user_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_project_document_versions_document_id_revision_pk" PRIMARY KEY("document_id","revision"),
	CONSTRAINT "internal_project_document_versions_title_check" CHECK (public.agency_project_title_valid("internal_project_document_versions"."title")),
	CONSTRAINT "internal_project_document_versions_revision_check" CHECK ("internal_project_document_versions"."revision" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "internal_project_document_versions_body_check" CHECK (octet_length("internal_project_document_versions"."body_html") <= 262144)
);
--> statement-breakpoint
CREATE TABLE "internal_project_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"create_intent_id" uuid NOT NULL,
	"title" text NOT NULL,
	"visibility" text NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"revision" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_project_documents_create_intent_key" UNIQUE("project_id","author_user_id","create_intent_id"),
	CONSTRAINT "internal_project_documents_title_check" CHECK (public.agency_project_title_valid("internal_project_documents"."title")),
	CONSTRAINT "internal_project_documents_visibility_check" CHECK ("internal_project_documents"."visibility" IN ('project', 'private')),
	CONSTRAINT "internal_project_documents_revision_check" CHECK ("internal_project_documents"."revision" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "internal_project_documents_body_check" CHECK (octet_length("internal_project_documents"."body_html") <= 262144)
);
--> statement-breakpoint
ALTER TABLE "internal_project_document_versions" ADD CONSTRAINT "internal_project_document_versions_editor_user_id_users_id_fk" FOREIGN KEY ("editor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_document_versions" ADD CONSTRAINT "internal_project_document_versions_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."internal_project_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_documents" ADD CONSTRAINT "internal_project_documents_project_id_agency_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_documents" ADD CONSTRAINT "internal_project_documents_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_project_documents_project_updated_idx" ON "internal_project_documents" USING btree ("project_id","updated_at" DESC NULLS LAST,"id");