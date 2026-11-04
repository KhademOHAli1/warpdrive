"use client";
import type { Ref } from "react";
import { formatTimeInput } from "@/components/ui/timeFormat";
import {
  useAppTranslations,
  useLocalePreferences,
  useMessages,
  useNumberingSystem,
} from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { MappingValueKind, MappingPreview as PreviewModel } from "../mappingTypes";

interface View {
  format: ReturnType<typeof useFormatters>;
  messages: ReturnType<typeof useMessages>["workflows"];
  preferences: ReturnType<typeof useLocalePreferences>;
  numbering: ReturnType<typeof useNumberingSystem>;
}
function scalarText(value: unknown, kind: MappingValueKind | "null", view: View): string {
  const { messages, format, preferences, numbering } = view;
  if (value === undefined) return messages.customValueOmitted;
  if (value === null) return messages.configurationNullValue;
  if (typeof value === "boolean") return value ? messages.boolTrue : messages.boolFalse;
  if (typeof value === "number") return format.number(value, { maximumSignificantDigits: 21 });
  if (typeof value !== "string") return messages.mappingInvalid;
  if (value === "") return messages.mappingEmptyText;
  if (kind === "date") return format.dateOnly(value) || `${value} · ${messages.mappingInvalid}`;
  if (kind === "instant") return format.dateTime(value) || `${value} · ${messages.mappingInvalid}`;
  return kind === "time" ? formatTimeInput(value, preferences.locale, numbering) : value;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function StructuredLiteral({
  value,
  intent,
  view,
}: {
  value: unknown;
  intent: MappingValueKind;
  view: View;
}) {
  const custom = useMessages().customFields;
  if (Array.isArray(value))
    return (
      <bdi dir="auto">
        {value
          .map((item: unknown) => (typeof item === "string" ? item : view.messages.mappingInvalid))
          .join(view.preferences.locale === "fa" ? "، " : ", ")}
      </bdi>
    );
  if (!record(value)) return null;
  const labels = {
    start: custom.start,
    end: custom.end,
    street: custom.street,
    city: custom.city,
    region: custom.region,
    postal: custom.postal,
    country: custom.country,
    lat: view.messages.customLatitude,
    lng: view.messages.customLongitude,
  };
  const kind = intent === "date-range" ? "date" : intent === "time-range" ? "time" : "text";
  const entries = Object.entries(value).flatMap(([key, item]) => {
    const label = Object.entries(labels).find(([name]) => name === key)?.[1];
    return label === undefined ? [] : [{ key, label, item }];
  });
  return (
    <dl className="space-y-1">
      {entries.map(({ key, label, item }) => (
        <div key={key}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd>
            <bdi dir="auto">{scalarText(item, kind, view)}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}
function LiteralPreview({
  model,
  view,
}: {
  model: Extract<PreviewModel, { state: "literal" }>;
  view: View;
}) {
  if (model.presence === "omitted") return <p>{view.messages.customValueOmitted}</p>;
  if (model.presence === "null") return <p>{view.messages.configurationNullValue}</p>;
  const structured = model.value !== null && typeof model.value === "object";
  return (
    <>
      {!model.valid && <p>{view.messages.mappingInvalid}</p>}
      {structured ? (
        <StructuredLiteral
          value={model.value}
          intent={model.intent === "null" ? "scalar" : model.intent}
          view={view}
        />
      ) : (
        <bdi dir="auto">{scalarText(model.value, model.intent, view)}</bdi>
      )}
    </>
  );
}
function PreviewContent({ model, view }: { model: PreviewModel; view: View }) {
  const { messages } = view;
  if (model.state === "unavailable") return <p>{messages.mappingUnavailable}</p>;
  if (model.state === "literal") return <LiteralPreview model={model} view={view} />;
  return (
    <>
      <p>{messages.mappingSynthetic}</p>
      <p>{messages.mappingFutureValue}</p>
      {model.possibleNull && <p>{messages.mappingPossibleNull}</p>}
      <bdi dir="auto">
        {model.example.value === undefined
          ? messages.mappingTypes[model.example.kind]
          : scalarText(model.example.value, model.example.kind, view)}
      </bdi>
    </>
  );
}
export function MappingPreview({
  model,
  focusRef,
  id,
  denied = false,
}: {
  model: PreviewModel;
  focusRef?: Ref<HTMLElement>;
  id?: string;
  denied?: boolean;
}) {
  const t = useAppTranslations("workflows");
  const messages = useMessages().workflows;
  const format = useFormatters();
  const preferences = useLocalePreferences();
  const numbering = useNumberingSystem();
  const view: View = { messages, format, preferences, numbering };
  return (
    <section
      ref={focusRef}
      id={id}
      tabIndex={-1}
      aria-label={t("mappingPreviewTitle")}
      className="space-y-2 rounded-md border p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <h3 className="font-medium">{t("mappingPreviewTitle")}</h3>
      {denied ? <p>{t("mappingDenied")}</p> : <PreviewContent model={model} view={view} />}
    </section>
  );
}
