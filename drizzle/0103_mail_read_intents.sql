CREATE TABLE "email_read_intents" (
	"actor_id" uuid NOT NULL,
	"operation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"mailbox_owner_id" uuid NOT NULL,
	"account_provider" text NOT NULL,
	"connection_generation" integer NOT NULL,
	"private_copy" boolean NOT NULL,
	"desired_read" boolean NOT NULL,
	"read_mode" text NOT NULL,
	"state" text DEFAULT 'prepared' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"admit_before" timestamp with time zone NOT NULL,
	"admitted_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"dispatch_claim" uuid,
	"error_id" text,
	CONSTRAINT "email_read_intents_pkey" PRIMARY KEY("actor_id","operation_id"),
	CONSTRAINT "email_read_intents_account_provider_check" CHECK ("email_read_intents"."account_provider" IN ('gmail','imap_smtp','microsoft')),
	CONSTRAINT "email_read_intents_connection_generation_check" CHECK ("email_read_intents"."connection_generation" > 0),
	CONSTRAINT "email_read_intents_read_mode_check" CHECK ("email_read_intents"."read_mode" IN ('local','imap')),
	CONSTRAINT "email_read_intents_state_check" CHECK ("email_read_intents"."state" IN ('prepared','admitted','applied','denied','cancelled','unknown')),
	CONSTRAINT "email_read_intents_check" CHECK ("email_read_intents"."admit_before" > "email_read_intents"."created_at"),
	CONSTRAINT "email_read_intents_check1" CHECK (NOT "email_read_intents"."private_copy" OR "email_read_intents"."read_mode"='local'),
	CONSTRAINT "email_read_intents_check2" CHECK ("email_read_intents"."read_mode"<>'imap' OR
        ("email_read_intents"."account_provider"='imap_smtp' AND "email_read_intents"."mailbox_owner_id"="email_read_intents"."actor_id")),
	CONSTRAINT "email_read_intents_check3" CHECK (("email_read_intents"."dispatch_claim" IS NULL) = ("email_read_intents"."admitted_at" IS NULL)),
	CONSTRAINT "email_read_intents_check4" CHECK ("email_read_intents"."state" NOT IN ('admitted','applied','unknown') OR "email_read_intents"."dispatch_claim" IS NOT NULL),
	CONSTRAINT "email_read_intents_check5" CHECK ("email_read_intents"."state" NOT IN ('prepared','cancelled') OR "email_read_intents"."dispatch_claim" IS NULL),
	CONSTRAINT "email_read_intents_check6" CHECK (("email_read_intents"."terminal_at" IS NOT NULL) = ("email_read_intents"."state" IN ('applied','denied','cancelled'))),
	CONSTRAINT "email_read_intents_check7" CHECK (("email_read_intents"."error_id" IS NOT NULL) = ("email_read_intents"."state" IN ('denied','unknown')))
);
--> statement-breakpoint
ALTER TABLE "email_read_intents" ADD CONSTRAINT "email_read_intents_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_read_intents" ADD CONSTRAINT "email_read_intents_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_read_intents" ADD CONSTRAINT "email_read_intents_thread_id_account_id_fkey" FOREIGN KEY ("thread_id","account_id") REFERENCES "public"."email_threads"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_read_intents_unresolved_actor_thread" ON "email_read_intents" USING btree ("actor_id","thread_id") WHERE "email_read_intents"."state" IN ('prepared','admitted','unknown');--> statement-breakpoint
CREATE INDEX "email_read_intents_expired_preparations" ON "email_read_intents" USING btree ("admit_before") WHERE "email_read_intents"."state"='prepared';--> statement-breakpoint
CREATE INDEX "email_read_intents_account" ON "email_read_intents" USING btree ("account_id");
--> statement-breakpoint
-- Receipt transition and TRUNCATE guards retained from the reviewed private source.
CREATE FUNCTION guard_email_read_intent_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.state IN ('admitted','unknown') THEN
      RAISE EXCEPTION 'unresolved mail read intent cannot be pruned' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP='INSERT' THEN
    IF NEW.state<>'prepared' THEN
      RAISE EXCEPTION 'mail read intent must begin prepared' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.actor_id,NEW.operation_id,NEW.account_id,NEW.thread_id,
      NEW.mailbox_owner_id,NEW.account_provider,NEW.connection_generation,
      NEW.private_copy,NEW.desired_read,NEW.read_mode,NEW.created_at,NEW.admit_before)
    IS DISTINCT FROM
    ROW(OLD.actor_id,OLD.operation_id,OLD.account_id,OLD.thread_id,
      OLD.mailbox_owner_id,OLD.account_provider,OLD.connection_generation,
      OLD.private_copy,OLD.desired_read,OLD.read_mode,OLD.created_at,OLD.admit_before) THEN
    RAISE EXCEPTION 'immutable mail read intent' USING ERRCODE='23514';
  END IF;

  IF OLD.state IN ('applied','denied','cancelled') THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'terminal mail read receipt' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.dispatch_claim IS NOT NULL AND
      ROW(NEW.dispatch_claim,NEW.admitted_at) IS DISTINCT FROM
      ROW(OLD.dispatch_claim,OLD.admitted_at) THEN
    RAISE EXCEPTION 'immutable mail read dispatch claim' USING ERRCODE='23514';
  END IF;

  IF NOT (
    (OLD.state='prepared' AND NEW.state IN ('prepared','admitted','denied','cancelled')) OR
    (OLD.state='admitted' AND NEW.state IN ('admitted','applied','denied','unknown')) OR
    (OLD.state='unknown' AND NEW.state='unknown')
  ) THEN
    RAISE EXCEPTION 'invalid mail read intent transition' USING ERRCODE='23514';
  END IF;

  -- This is an admission cutoff, not a claim that in-flight work has stopped.
  IF OLD.state='prepared' AND NEW.state='admitted' AND
      clock_timestamp() >= OLD.admit_before THEN
    RAISE EXCEPTION 'expired mail read intent admission' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_read_intents_guard_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON email_read_intents
  FOR EACH ROW EXECUTE FUNCTION guard_email_read_intent_mutation();

-- TRUNCATE bypasses row DELETE triggers, including through a parent CASCADE.
-- Its ACCESS EXCLUSIVE lock excludes writers while this statement guard runs.
--> statement-breakpoint
CREATE FUNCTION guard_email_read_intent_truncate() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  -- A zero-length physical heap has no rows, independent of the caller's MVCC snapshot.
  IF pg_catalog.pg_relation_size(TG_RELID::pg_catalog.regclass,'main')=0 THEN
    RETURN NULL;
  END IF;

  -- A nonempty heap cannot be certified empty/terminal from an old transaction snapshot.
  -- At READ COMMITTED, this VOLATILE function reads after the TRUNCATE lock was acquired.
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'unresolved mail read intent cannot be truncated without fresh visibility'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.email_read_intents WHERE state IN ('admitted','unknown')) THEN
    RAISE EXCEPTION 'unresolved mail read intent cannot be truncated' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_read_intents_guard_truncate
  BEFORE TRUNCATE ON email_read_intents
  FOR EACH STATEMENT EXECUTE FUNCTION guard_email_read_intent_truncate();
