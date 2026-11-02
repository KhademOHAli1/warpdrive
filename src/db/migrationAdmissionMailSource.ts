import { err, ok, type Result } from "@/types/result";
import type { CanonicalMigration } from "./migrationAdmission";

export type MailFunctionProtection = {
  name: string;
  arguments: string;
  returns: string;
  language: string;
  body: string;
  volatility: string;
  strict: boolean;
  parallel: string;
  definer: boolean;
  config: string;
};
export type MailTriggerProtection = {
  name: string;
  table: string;
  function: string;
  events: string;
  type: number;
};
export type MailPointerProtection = {
  name: string;
  table: string;
  pointer: string;
  target: string;
};
type MailProtections = {
  functions: MailFunctionProtection[];
  triggers: MailTriggerProtection[];
  pointers: MailPointerProtection[];
};

const deliveryTriggers: MailTriggerProtection[] = [
  {
    name: "email_delivery_reports_immutable",
    table: "email_delivery_reports",
    function: "email_delivery_report_guard",
    events: "UPDATE OR DELETE",
    type: 27,
  },
  {
    name: "email_delivery_reviews_immutable",
    table: "email_delivery_reviews",
    function: "email_delivery_review_guard",
    events: "UPDATE OR DELETE",
    type: 27,
  },
];
const intakeTriggers: MailTriggerProtection[] = [
  {
    name: "email_private_intake_immutable",
    table: "email_private_intake",
    function: "email_private_intake_guard",
    events: "INSERT OR UPDATE OR DELETE",
    type: 31,
  },
  {
    name: "email_private_intake_reviews_immutable",
    table: "email_private_intake_reviews",
    function: "email_private_intake_review_guard",
    events: "INSERT OR UPDATE OR DELETE",
    type: 31,
  },
];
const groups = [
  {
    suffix: "_mail_delivery_observations",
    functions: ["email_delivery_report_guard", "email_delivery_review_guard"],
    triggers: deliveryTriggers,
    pointers: [
      {
        name: "email_delivery_review_attempt_same_account_fk",
        table: "email_delivery_reviews",
        pointer: "attempt_id",
        target: "email_send_attempts",
      },
    ],
  },
  {
    suffix: "_private_mail_intake",
    functions: [
      "private_intake_hash_v1",
      "private_intake_message_v1",
      "private_intake_thread_v1",
      "private_intake_attachment_v1",
      "private_intake_baseline_v1",
      "private_intake_assert_owned_v1",
      "email_private_intake_guard",
      "email_private_intake_review_guard",
    ],
    triggers: intakeTriggers,
    pointers: [
      {
        name: "email_private_intake_message_same_account_fk",
        table: "email_private_intake",
        pointer: "owned_message_id",
        target: "email_messages",
      },
      {
        name: "email_private_intake_attempt_same_account_fk",
        table: "email_private_intake",
        pointer: "confirmation_attempt_id",
        target: "email_send_attempts",
      },
    ],
  },
];
const invalidSource = () => err("invalid canonical mail protection source");

function declaration(statement: string): string {
  let value = statement.trim();
  while (value.startsWith("--")) {
    const end = value.indexOf("\n");
    if (end < 0) return "";
    value = value.slice(end + 1).trim();
  }
  return value;
}

// This accepts only the function DDL forms used by the two versioned Mail migrations.
// Named dollar delimiters preserve exact body bytes and malformed declarations fail closed.
function functionProtection(source: string): MailFunctionProtection | null {
  const match = source.match(
    /^CREATE FUNCTION public\.(?<name>[a-z0-9_]+)\((?<args>[^()]*)\)\s+RETURNS\s+(?<returns>[\s\S]+?)\s+LANGUAGE\s+(?<language>sql|plpgsql)(?<options>[\s\S]*?)\s+AS\s+(?<delimiter>\$[a-z0-9_]+\$)(?<body>[\s\S]*)\k<delimiter>;\s*$/u,
  );
  const { name, args, returns, language, options, body } = match?.groups ?? {};
  if (
    name === undefined ||
    args === undefined ||
    returns === undefined ||
    language === undefined ||
    options === undefined ||
    body === undefined
  )
    return null;
  const normalizedArgs = args.trim().replace(/\s+/gu, " ");
  if (
    normalizedArgs !== "" &&
    !/^[a-z0-9_]+ (?:jsonb|uuid|public\.[a-z0-9_]+)(?:, [a-z0-9_]+ (?:jsonb|uuid|public\.[a-z0-9_]+))*$/u.test(
      normalizedArgs,
    )
  )
    return null;
  const normalizedReturn = returns.trim().replace(/\s+/gu, " ");
  if (
    !/^(?:trigger|text|jsonb|void|TABLE\([a-z0-9_]+ text(?:, [a-z0-9_]+ text)*\))$/u.test(
      normalizedReturn,
    )
  )
    return null;
  const flags = options
    .trim()
    .match(
      /^(?:(IMMUTABLE|STABLE|VOLATILE)\s+)?(?:(STRICT)\s+)?(?:PARALLEL (SAFE|RESTRICTED|UNSAFE)\s+)?(?:SECURITY (INVOKER|DEFINER)\s+)?SET search_path = (pg_catalog, public)$/u,
    );
  if (flags === null) return null;
  return {
    name,
    arguments: normalizedArgs.replaceAll("public.", ""),
    returns: normalizedReturn,
    language,
    body,
    volatility: flags[1] === "IMMUTABLE" ? "i" : flags[1] === "STABLE" ? "s" : "v",
    strict: flags[2] === "STRICT",
    parallel: flags[3] === "SAFE" ? "s" : flags[3] === "RESTRICTED" ? "r" : "u",
    definer: flags[4] === "DEFINER",
    config: `search_path=${flags[5] ?? ""}`,
  };
}

function namedFunction(statements: string[], name: string): MailFunctionProtection | null {
  const declarations = statements.filter((statement) =>
    statement.startsWith(`CREATE FUNCTION public.${name}(`),
  );
  if (declarations.length !== 1) return null;
  const source = declarations[0];
  const parsed = source === undefined ? null : functionProtection(source);
  return parsed?.name === name ? parsed : null;
}

function triggerSourceMatches(statements: string[], trigger: MailTriggerProtection): boolean {
  const expected = `CREATE TRIGGER ${trigger.name} BEFORE ${trigger.events} ON public.${trigger.table} FOR EACH ROW EXECUTE FUNCTION public.${trigger.function}();`;
  return (
    statements.filter((statement) => statement.replace(/\s+/gu, " ") === expected).length === 1
  );
}

function pointerSourceMatches(statements: string[], pointer: MailPointerProtection): boolean {
  const expected = `ALTER TABLE "${pointer.table}" ADD CONSTRAINT "${pointer.name}" FOREIGN KEY ("${pointer.pointer}","account_id") REFERENCES "public"."${pointer.target}"("id","account_id") ON DELETE SET NULL ("${pointer.pointer}") ON UPDATE no action;`;
  return statements.filter((statement) => statement === expected).length === 1;
}

function groupProtections(
  migration: CanonicalMigration,
  group: (typeof groups)[number],
): Result<MailProtections, string> {
  const statements = migration.sql.map(declaration);
  const functions = group.functions
    .map((name) => namedFunction(statements, name))
    .filter((entry): entry is MailFunctionProtection => entry !== null);
  if (
    functions.length !== group.functions.length ||
    !group.triggers.every((trigger) => triggerSourceMatches(statements, trigger)) ||
    !group.pointers.every((pointer) => pointerSourceMatches(statements, pointer))
  )
    return invalidSource();
  return ok({ functions, triggers: group.triggers, pointers: group.pointers });
}

export function readMailProtections(
  canonical: readonly CanonicalMigration[],
): Result<MailProtections, string> {
  const protections: MailProtections = { functions: [], triggers: [], pointers: [] };
  for (const group of groups) {
    const migrations = canonical.filter((entry) => entry.tag.endsWith(group.suffix));
    if (migrations.length === 0) continue;
    if (migrations.length !== 1) return invalidSource();
    const migration = migrations[0];
    if (migration === undefined) return invalidSource();
    const parsed = groupProtections(migration, group);
    if (!parsed.ok) return parsed;
    protections.functions.push(...parsed.value.functions);
    protections.triggers.push(...parsed.value.triggers);
    protections.pointers.push(...parsed.value.pointers);
  }
  return ok(protections);
}
