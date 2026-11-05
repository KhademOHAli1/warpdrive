import { classifyInventory } from "./registryClassification";
import { kpiIds1 } from "./registryIdsKpis1";

export const kpiInventoryEntry = classifyInventory(kpiIds1, {
  owner: "Goals, reusable KPI definitions and scorecards",
  categories: [
    "workforce creator, recorder, viewer and assignment references and current visible scope names",
    "user-authored KPI names, descriptions, filters, conditions and scorecard revisions",
    "manual measurement values, dates, sample sizes and free-text source notes",
    "viewer-filtered CRM record references, labels, values, selected observation dates, missing-date quality counts, current statuses and derived performance results",
    "manual period snapshots, preserved definitions, assignments and contributing-note copies",
    "transient browser forms, previews, result trends and request-order state",
  ],
  subjectRelation:
    "A workforce actor, assignee or snapshot viewer is distinct from any person described by a KPI name, source note or contributing CRM record. Company, team and person assignment scope governs ordinary result visibility; it does not establish privacy subject identity, reviewed case scope or authority to disclose an entire scorecard or free-text observation.",
  purpose:
    "Create append-only KPI and scorecard revisions, assign version-pinned targets, record source-noted manual observations, evaluate visible CRM records and explicitly capture completed manual periods for the requesting viewer. Present bounded previews, cumulative trends and contributing records in Settings and Performance. Canonical migration 0106 declares the five tables, foreign keys, indexes and immutability triggers; source registration alone is not evidence of an installed populated upgrade.",
  disclosure:
    "Mutating Server Actions require native active-session, CSRF and goals.manage checks. Result reads reauthorize assignment scope; CRM calculations additionally apply current deal or dominant-parent activity visibility. Scope labels project only the current user or team name for already-visible assignments, without directory email or unrelated profile fields. Live contributing records expose the selected observation date and current status under the same record authorization. Company-scoped manual observations are shared with authorized ordinary company-goal viewers; notes may contain third-party or confidential text. Snapshots are viewer-bound, restricted to manual sources and omit contributors when returned. None of these ordinary product permissions grants privacy export, portability or unrestricted disclosure authority.",
  retention:
    "Definition and scorecard revisions, manual observations and snapshots are append-only; migration triggers reject ordinary UPDATE and DELETE on those tables. Goal assignments are pinned against changes while archive state can change. Archive is not erasure. Explicit snapshots retain their result, assignment, definition and source-note copies in PostgreSQL; user and revision foreign keys and append-only triggers require a coordinated lifecycle disposition. There is no KPI export, rectification, restriction, physical-erasure adapter, automatic expiry or activated retention schedule. Browser forms, previews and result rows use component memory with request-generation suppression; that is not proof of physical memory erasure. Database and backup copies retain their separately classified lifecycle requirements.",
  externalEffects:
    "Existing PostgreSQL reads and KPI row inserts/goal archive updates only; execute:sql identifiers here are SELECT queries. The KpiSchemeForm update:target, update:upperTarget and update:baseline identifiers are lexical matches for local numeric-form normalization and state changes, not database writers. Derived Map/Set structures are transient calculation and presentation bookkeeping. No KPI queue, provider connection, object storage, mail delivery, persistent browser store, telemetry destination or external source-system fetch is introduced. Manual templates describe required sources without connecting to those systems.",
  erasureTask: "DPL-15",
});
