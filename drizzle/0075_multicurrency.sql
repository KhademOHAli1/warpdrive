-- Freeze the existing company unit onto every monetary record, including archived/deleted rows.
-- A database default also protects direct inserts and older API clients without rewriting values.
CREATE FUNCTION public.warpdrive_base_currency() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$ SELECT coalesce((SELECT base_currency FROM public.settings WHERE id = true), 'USD') $$;
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "currency" text DEFAULT public.warpdrive_base_currency() NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "currency" text DEFAULT public.warpdrive_base_currency() NOT NULL;
--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "currency" text DEFAULT public.warpdrive_base_currency() NOT NULL;
--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "value" TYPE numeric(18, 4);
--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "value" TYPE numeric(18, 4);
--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "target" TYPE numeric(18, 4);
