-- Keep the old row data, including updated_at, unchanged while initializing versions.
-- Adding without a volatile default avoids ADD COLUMN's table rewrite. The explicit
-- backfill still updates every existing row and produces WAL; SET NOT NULL scans the
-- table, and the enclosing migration transaction holds ALTER TABLE's exclusive lock.
-- This is not an online/backfill-without-locks migration. Large installed tables need
-- a measured maintenance/upgrade plan; canonical migration timeouts fail closed.
ALTER TABLE public.deals ADD COLUMN write_version uuid;
--> statement-breakpoint
UPDATE public.deals SET write_version = pg_catalog.gen_random_uuid()
WHERE write_version IS NULL;
--> statement-breakpoint
ALTER TABLE public.deals ALTER COLUMN write_version SET DEFAULT pg_catalog.gen_random_uuid();
--> statement-breakpoint
ALTER TABLE public.deals ALTER COLUMN write_version SET NOT NULL;
--> statement-breakpoint
CREATE FUNCTION public.assign_deal_write_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  -- INSERT callers, including duplicate/import paths, cannot choose or copy a token.
  -- Every SQL UPDATE rotates it, even if it preserves updated_at or is otherwise a no-op.
  NEW.write_version := pg_catalog.gen_random_uuid();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER deals_write_version_owned
BEFORE INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.assign_deal_write_version();
