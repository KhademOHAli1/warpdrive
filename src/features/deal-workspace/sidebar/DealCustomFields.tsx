"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CreateFieldDialog } from "@/features/custom-fields/CreateFieldDialog";
import { useSalesStrings } from "@/features/deals/useSalesStrings";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { CustomFieldDef } from "@/types/customFields";
import { CollapsibleSection } from "../CollapsibleSection";
import type { CustomFieldsSave } from "./customFieldsSave";
import { DetailsBlock } from "./DetailsBlock";
import { SectionHeaderMenu } from "./SectionHeaderMenu";

export function DealCustomFields({
  defs,
  values,
  currency,
  canManage,
  onSave,
}: {
  defs: CustomFieldDef[];
  values: Record<string, unknown>;
  currency: string;
  canManage: boolean;
  onSave: CustomFieldsSave;
}) {
  const t = useAppTranslations("dealWorkspace");
  const router = useRouter();
  const strings = useSalesStrings();
  const [created, setCreated] = useState<CustomFieldDef[]>([]);
  const fields = [...defs, ...created.filter((field) => !defs.some((def) => def.id === field.id))];
  if (!canManage && fields.length === 0) return null;

  return (
    <CollapsibleSection
      title={t("details")}
      defaultOpen
      defaultHideEmpty={false}
      headerActions={() =>
        canManage ? (
          <SectionHeaderMenu
            sectionLabel={t("details")}
            menuItems={[
              {
                label: strings.dealSidebar.menu.customizeFields,
                onSelect: () => router.push("/settings/fields?entity=deal"),
              },
            ]}
          />
        ) : null
      }
    >
      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("noCustomFields")}</p>
      ) : (
        <DetailsBlock
          editingFieldId={created.at(-1)?.id}
          customFieldDefs={fields}
          customFields={values}
          currency={currency}
          onSave={onSave}
        />
      )}
      {canManage && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
          <CreateFieldDialog
            target="deal"
            entityLabel={t("deals")}
            description={t("fieldScope")}
            onCreated={(field) => setCreated((current) => [...current, field])}
            trigger={
              <Button variant="outline" size="sm">
                {t("addField")}
              </Button>
            }
          />
          <Link
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            href="/settings/fields?entity=deal"
          >
            {t("manageFields")}
          </Link>
        </div>
      )}
    </CollapsibleSection>
  );
}
