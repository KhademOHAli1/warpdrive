"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import type { DealStatus } from "@/constants/dealStatus";
import type { OrgDetail } from "@/features/contacts/orgsRepo";
import { CollapsibleSection } from "@/features/deal-workspace/CollapsibleSection";
import { FieldRow } from "@/features/deal-workspace/sidebar/FieldRow";
import { OrganizationSection } from "@/features/deal-workspace/sidebar/OrganizationSection";
import { SectionHeaderMenu } from "@/features/deal-workspace/sidebar/SectionHeaderMenu";
import { FindPeopleButton } from "@/features/enrichment/prospects/FindPeopleButton";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { CustomFieldDef } from "@/types/customFields";
import { ContactOverviewSection } from "../../ContactOverviewSection";
import { ListPanel } from "../../contactDetail.shared";
import { customizeFieldsItem } from "../../contactSectionMenu";
import { LinkedDealRow } from "../../LinkedDealRow";
import { RelatedOrgsPanel } from "./RelatedOrgsPanel";

type RelatedOrg = React.ComponentProps<typeof RelatedOrgsPanel>["related"];

// Org detail sidebar (CO-2): Summary / Details / Related organizations / Stats are collapsible
// sections with the shared section header menu (pencil reveals empty fields), matching the deal
// sidebar. Stats keeps the Open-deals count; the activity Overview widget renders below it (PD
// shows Overview on org detail as well as person).
export function OrgSidebar({
  org,
  defs,
  hiddenBuiltins = new Set(),
  baseCurrency,
  relatedOrgs,
  orgOptions,
  openDealsCount,
  people,
  deals,
  onRelatedChanged,
}: {
  org: OrgDetail;
  defs: CustomFieldDef[];
  hiddenBuiltins?: ReadonlySet<string>;
  baseCurrency: string;
  relatedOrgs: RelatedOrg;
  orgOptions: { id: string; name: string }[];
  openDealsCount: number;
  people: { id: string; name: string }[];
  deals: { id: string; title: string; status: DealStatus }[];
  onRelatedChanged: () => void;
}): React.ReactNode {
  const tContacts = useAppTranslations("contacts");
  const format = useFormatters();

  const router = useRouter();
  const [organizationBulkEditing, setOrganizationBulkEditing] = useState(false);
  const push = (href: string): void => router.push(href);
  const orgFieldsItem = customizeFieldsItem(push, "organization", tContacts("customizeFields"));

  return (
    <aside className="space-y-2 min-w-0 lg:order-first">
      <OrganizationSection
        org={org}
        menuItems={[orgFieldsItem]}
        bulkEditing={organizationBulkEditing}
        onStartBulk={() => setOrganizationBulkEditing(true)}
        onExitBulk={() => setOrganizationBulkEditing(false)}
        hidden={hiddenBuiltins}
        customFieldDefs={defs}
        currency={baseCurrency}
      />

      <CollapsibleSection title={tContacts("relatedOrganizations")}>
        <RelatedOrgsPanel
          orgId={org.id}
          related={relatedOrgs}
          orgOptions={orgOptions}
          onChanged={onRelatedChanged}
        />
      </CollapsibleSection>

      <CollapsibleSection title={tContacts("stats")}>
        <FieldRow label={tContacts("openDeals")}>
          <span className="tabular-nums">{format.number(openDealsCount)}</span>
        </FieldRow>
      </CollapsibleSection>

      {/* CO-2 / spec B2: PD shows an activity Overview on org detail too, not just person. */}
      <ContactOverviewSection entityType="organization" entityId={org.id} />

      <CollapsibleSection
        title={tContacts("people")}
        headerActions={() => (
          <FindPeopleButton orgId={org.id} orgName={org.name}>
            {(findPeople) =>
              findPeople === null ? null : (
                <SectionHeaderMenu sectionLabel={tContacts("people")} menuItems={[findPeople]} />
              )
            }
          </FindPeopleButton>
        )}
      >
        <ListPanel
          items={people}
          empty={tContacts("noPeopleYet")}
          render={(person) => (
            <li key={person.id}>
              <Link
                href={`/contacts/people/${person.id}`}
                className="block rounded px-1 py-1 text-sm text-primary transition-colors duration-150 hover:bg-accent hover:underline motion-reduce:transition-none"
              >
                {person.name}
              </Link>
            </li>
          )}
        />
      </CollapsibleSection>

      <CollapsibleSection title={tContacts("deals")}>
        <ListPanel
          items={deals}
          empty={tContacts("noDealsYet")}
          render={(deal) => <LinkedDealRow key={deal.id} deal={deal} />}
        />
      </CollapsibleSection>
    </aside>
  );
}
