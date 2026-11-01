// Pure step machine for the import wizard. The reducer enforces order (upload ->
// map after a batch is created -> preview after validation) and translates the
// UI's per-column choices into the backend columnMappingSchema shape via
// buildColumnMapping. No React, no I/O: the orchestrator owns the async calls.
import { DEFAULT_IMPORT_SOURCE, type ImportSource } from "@/constants/importSources";
import type { CalendarSystem } from "@/lib/localeFormatting";
import { assertNever } from "@/types/result";
import type { PhoneCountry } from "@/utils/phoneNormalization";
import { IMPORT_DATE_FIELDS } from "./importDateConventions";
import type { MappableEntity } from "./importFields";
import { primaryEntityOf, requiredFieldsFor, targetsFor } from "./importFields";
import type { ColumnMapping } from "./schemas";
import { reseed, type SuggestContext, seedColumns } from "./wizardSeed";

export type WizardStep = "upload" | "preparing" | "map" | "validating" | "preview" | "commit";
export type ImportTarget = "person" | "organization" | "deal" | "lead" | "activity" | "note";

// One CSV column's destination: an entity, plus exactly one of a standard `field` or a custom
// `key`. Both empty means "do not import this column". The entity is what lets one row write a
// lead AND its organization AND a note (see importFields.TARGET_ENTITY_GROUPS).
export interface ColumnChoice {
  entity: MappableEntity;
  field: string;
  isCustom: boolean;
  key: string;
}

export interface WizardState {
  step: WizardStep;
  source: ImportSource;
  createMissingStages: boolean;
  phoneCountry?: PhoneCountry;
  dateCalendar?: CalendarSystem;
  dateTimeZone?: string;
  target: ImportTarget;
  filename: string;
  headers: string[];
  rows: Record<string, string>[];
  batchId: string | null;
  totalRows: number;
  dedupMode: "skip" | "update";
  columns: Record<string, ColumnChoice>;
  // Collect every unmapped, non-empty cell into a note on the created record.
  rowNoteFromUnmapped: boolean;
  validation: { valid: number; invalid: number } | null;
}

export function initialWizardState(): WizardState {
  return {
    step: "upload",
    source: DEFAULT_IMPORT_SOURCE,
    createMissingStages: false,
    target: "person",
    filename: "",
    headers: [],
    rows: [],
    batchId: null,
    totalRows: 0,
    dedupMode: "skip",
    columns: {},
    rowNoteFromUnmapped: false,
    validation: null,
  };
}

export type WizardAction =
  | { type: "setTarget"; target: ImportTarget; suggest?: SuggestContext }
  | { type: "setSource"; source: ImportSource; suggest?: SuggestContext }
  | { type: "setCreateMissingStages"; createMissingStages: boolean }
  | { type: "setPhoneCountry"; phoneCountry: PhoneCountry | undefined }
  | { type: "setDateCalendar"; dateCalendar: CalendarSystem }
  | { type: "setDateTimeZone"; dateTimeZone: string }
  | {
      type: "loadFile";
      filename: string;
      headers: string[];
      rows: Record<string, string>[];
      suggest?: SuggestContext;
    }
  | { type: "setColumn"; header: string; choice: ColumnChoice }
  | { type: "setDedup"; dedupMode: "skip" | "update" }
  | { type: "setRowNote"; rowNoteFromUnmapped: boolean }
  | { type: "batchCreated"; batchId: string }
  | { type: "uploaded"; batchId: string; source: ImportSource; target: ImportTarget }
  | {
      type: "prepared";
      headers: string[];
      totalRows: number;
      previewRows: Record<string, string>[];
      suggest?: SuggestContext;
    }
  | { type: "validated"; validation: { valid: number; invalid: number } }
  | { type: "goto"; step: WizardStep }
  | { type: "reset" };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "setTarget":
      return {
        ...state,
        target: action.target,
        validation: null,
        columns: reseed(state.headers, action.target, state.source, action.suggest),
      };
    case "setSource": {
      const target = targetsFor(action.source).includes(state.target) ? state.target : "person";
      return {
        ...state,
        source: action.source,
        validation: null,
        target,
        columns: reseed(state.headers, target, action.source, action.suggest),
      };
    }
    case "setDateCalendar":
      return { ...state, validation: null, dateCalendar: action.dateCalendar };
    case "setDateTimeZone":
      return { ...state, validation: null, dateTimeZone: action.dateTimeZone };
    case "setPhoneCountry":
      return { ...state, validation: null, phoneCountry: action.phoneCountry };
    case "setCreateMissingStages":
      return { ...state, validation: null, createMissingStages: action.createMissingStages };
    case "loadFile":
      return {
        ...state,
        filename: action.filename,
        headers: action.headers,
        rows: action.rows,
        columns: seedColumns(action.headers, state.target, state.source, action.suggest),
        batchId: null,
        validation: null,
      };
    case "setColumn":
      return {
        ...state,
        validation: null,
        columns: { ...state.columns, [action.header]: action.choice },
      };
    case "setDedup":
      return { ...state, validation: null, dedupMode: action.dedupMode };
    case "setRowNote":
      return { ...state, validation: null, rowNoteFromUnmapped: action.rowNoteFromUnmapped };
    case "batchCreated":
      return { ...state, validation: null, batchId: action.batchId, step: "map" };
    case "uploaded":
      return {
        ...state,
        validation: null,
        batchId: action.batchId,
        source: action.source,
        target: action.target,
        step: "preparing",
      };
    case "prepared":
      return {
        ...state,
        validation: null,
        headers: action.headers,
        totalRows: action.totalRows,
        rows: action.previewRows,
        columns: seedColumns(action.headers, state.target, state.source, action.suggest),
        step: "map",
      };
    case "validated":
      if (state.step !== "validating") return state;
      return { ...state, validation: action.validation, step: "preview" };
    case "goto":
      if (state.step === "commit") return state;
      if (action.step === "preview" && state.validation === null) return state;
      if (
        action.step === "commit" &&
        (state.step !== "preview" || state.validation === null || state.validation.valid === 0)
      )
        return state;
      return {
        ...state,
        step: action.step,
        validation: action.step === "map" || action.step === "validating" ? null : state.validation,
      };
    case "reset":
      return initialWizardState();
    default:
      return assertNever(action);
  }
}

// The standard (non-custom) fields the current mapping targets, keyed "entity:field". The entity
// has to be part of the key: Organization > Name and Person > Name are different destinations, and
// a person import must not count the former as satisfying its required Name.
function mappedFields(state: WizardState): Set<string> {
  const out = new Set<string>();
  for (const col of Object.values(state.columns)) {
    if (!col.isCustom && col.field !== "") out.add(`${col.entity}:${col.field}`);
  }
  return out;
}

// A mapping is complete once every REQUIRED field of the target's PRIMARY entity has a column
// mapped to it (name for person/org, title for deal/lead, subject for activity); the map step's
// Continue stays disabled until then. A related group's required field (Organization > Name) is
// enforced at validate time, since the group is optional until one of its cells is filled.
export function isMappingComplete(
  state: WizardState,
  source: ImportSource = DEFAULT_IMPORT_SOURCE,
): boolean {
  const mapped = mappedFields(state);
  const primary = primaryEntityOf(state.target);
  return requiredFieldsFor(state.target, source).every((f) =>
    [f.field, ...(f.satisfiedBy ?? [])].some((field) => mapped.has(`${primary}:${field}`)),
  );
}

// Project the UI choices onto the backend's columnMappingSchema, dropping columns
// the user left unmapped so applyMapping ignores them.
export function buildColumnMapping(state: WizardState): ColumnMapping {
  const columns: ColumnMapping["columns"] = {};
  for (const [header, choice] of Object.entries(state.columns)) {
    if (choice.field === "" && choice.key === "") continue;
    columns[header] = choice;
  }
  return {
    dedupMode: state.dedupMode,
    columns,
    options: {
      rowNoteFromUnmapped: state.rowNoteFromUnmapped,
      ...(state.phoneCountry === undefined ? {} : { phoneCountry: state.phoneCountry }),
      ...(state.dateCalendar !== undefined ||
      state.dateTimeZone !== undefined ||
      Object.values(state.columns).some((column) =>
        IMPORT_DATE_FIELDS.some((field) => field === column.field),
      )
        ? {
            dateCalendar: state.dateCalendar ?? "gregory",
            dateTimeZone: state.dateTimeZone ?? "UTC",
          }
        : {}),
      createMissingStages:
        state.source === "pipedrive" && state.target === "deal" && state.createMissingStages,
    },
  };
}
