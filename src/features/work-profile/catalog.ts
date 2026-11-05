import { field, type Locale, localized, source } from "./catalog-data";
import type { Preset } from "./contracts";
export function workCatalog(locale: Locale): Preset[] {
  return source.map((p) => ({
    id: p.id,
    version: 1,
    name: localized([...p.name], locale),
    description: localized([...p.description], locale),
    sales: {
      name: localized([...p.sales], locale),
      stages: p.salesStages.map((v) => localized([...v], locale)),
    },
    delivery: {
      name: localized([...p.delivery], locale),
      stages: [
        ...p.deliveryStages.map(([key, ...labels], i, all) => ({
          key,
          name: localized(labels, locale),
          bucket: i === all.length - 1 ? ("complete" as const) : ("open" as const),
        })),
        {
          key: "canceled",
          name: localized(["Canceled", "Abgebrochen", "لغوشده"], locale),
          bucket: "canceled",
        },
      ],
      fields: p.fields.map(([key, en, de, fa, type]) =>
        field(key, localized([en, de, fa], locale), type),
      ),
    },
    dealFields: [
      {
        key: `wp_${p.id}_${p.dealField[0]}`,
        name: localized([p.dealField[1], p.dealField[2], p.dealField[3]], locale),
        type: "text",
      },
    ],
    activityTypes: [
      {
        key: `wp_${p.id}_${p.activity[0]}`,
        name: localized([p.activity[1], p.activity[2], p.activity[3]], locale),
        icon: p.activity[4],
      },
    ],
  }));
}
