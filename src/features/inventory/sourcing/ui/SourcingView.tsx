"use client";

import { PackagePlus } from "lucide-react";
import { type MouseEvent, useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useFormatters } from "@/lib/useFormatters";
import { CatalogField, CatalogSelect } from "../../catalog/ui/CatalogFields";
import {
  calculateStockUnits,
  chooseSourcingTier,
  type SourcingMoney,
  type SourcingOffer,
  type SourcingPriceTier,
} from "../contracts";
import type { SourcingMessages } from "./messages";
import type { Editor, Workspace } from "./types";

type OpenEditor = (event: MouseEvent<HTMLButtonElement>, editor: Editor) => void;
type Pricing = NonNullable<Workspace["pricing"]>;

const cell = "px-3 py-2.5 text-start align-top";
const heading = "px-3 py-2 text-start font-medium";

function SectionHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-3 text-sm text-muted-foreground">{children}</p>;
}

function Money({ value }: { value: SourcingMoney }) {
  const { currency } = useFormatters();
  return (
    <bdi className="tabular-nums">
      {currency(value.amount, value.currency)} {value.currency}
    </bdi>
  );
}

function Manufacturers({
  workspace,
  canBuy,
  busy,
  open,
  t,
}: {
  workspace: Workspace;
  canBuy: boolean;
  busy: boolean;
  open: OpenEditor;
  t: SourcingMessages;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <SectionHeading title={t.manufacturerParts}>
        {canBuy && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || workspace.organizations.length === 0}
            onClick={(event) => open(event, { type: "manufacturer", row: null })}
          >
            <PackagePlus aria-hidden="true" />
            {t.newManufacturer}
          </Button>
        )}
      </SectionHeading>
      {workspace.manufacturers.length === 0 ? (
        <Empty>{t.noManufacturers}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label={t.manufacturerParts} className="w-full text-sm">
            <thead className="border-y bg-muted/40 text-muted-foreground">
              <tr>
                <th scope="col" className={heading}>
                  {t.manufacturer}
                </th>
                <th scope="col" className={heading}>
                  {t.manufacturerNumber}
                </th>
                {canBuy && (
                  <th scope="col" className={heading}>
                    {t.actions}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {workspace.manufacturers.map((row) => (
                <tr key={row.id} data-manufacturer-part-id={row.id}>
                  <td className={cell}>
                    <bdi>{row.organizationName}</bdi>
                  </td>
                  <td className={cell}>
                    <bdi className="break-all">{row.partNumber}</bdi>
                  </td>
                  {canBuy && (
                    <td className={cell}>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={(event) => open(event, { type: "manufacturer", row })}
                      >
                        {t.editManufacturer}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Offers({
  workspace,
  pricing,
  canBuy,
  canEditPrices,
  busy,
  open,
  selectedOffer,
  selectOffer,
  t,
}: {
  workspace: Workspace;
  pricing: Pricing | undefined;
  canBuy: boolean;
  canEditPrices: boolean;
  busy: boolean;
  open: OpenEditor;
  selectedOffer: SourcingOffer | undefined;
  selectOffer: (offer: SourcingOffer) => void;
  t: SourcingMessages;
}) {
  const packsId = useId();
  const tiersId = useId();
  const [packInput, setPackInput] = useState("1");
  const [requestedCurrency, setRequestedCurrency] = useState("");
  const currencies = [...new Set(pricing?.tiers.map(({ currency }) => currency))].sort();
  const currency = currencies.includes(requestedCurrency)
    ? requestedCurrency
    : (currencies[0] ?? "");
  const { number } = useFormatters();
  const packs = Number(packInput);
  const showActions = canBuy || pricing !== undefined;
  const manufacturers = new Map(workspace.manufacturers.map((row) => [row.id, row]));
  const pricingAction = canEditPrices ? t.managePrices : t.viewPrices;
  return (
    <section className="rounded-lg border bg-card">
      <SectionHeading title={t.supplierOffers}>
        {canBuy && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || workspace.organizations.length === 0}
            onClick={(event) => open(event, { type: "offer", row: null })}
          >
            <PackagePlus aria-hidden="true" />
            {t.newOffer}
          </Button>
        )}
      </SectionHeading>
      {workspace.offers.length === 0 ? (
        <Empty>{t.noOffers}</Empty>
      ) : (
        <>
          <div className="grid gap-3 px-3 pb-3 sm:max-w-md sm:grid-cols-2">
            <CatalogField label={t.packs} id={packsId}>
              <Input
                id={packsId}
                type="number"
                min={1}
                max={1_000_000}
                step={1}
                value={packInput}
                aria-invalid={calculateStockUnits(packs, 1) === null}
                onChange={(event) => setPackInput(event.target.value)}
              />
            </CatalogField>
            {currencies.length > 0 && (
              <CatalogField label={t.quoteCurrency}>
                <CatalogSelect
                  ariaLabel={t.quoteCurrency}
                  value={currency}
                  onChange={setRequestedCurrency}
                  options={currencies.map((code) => ({ label: code, value: code }))}
                />
              </CatalogField>
            )}
          </div>
          <div className="overflow-x-auto">
            <table aria-label={t.supplierOffers} className="w-full text-sm">
              <thead className="border-y bg-muted/40 text-muted-foreground">
                <tr>
                  <th scope="col" className={heading}>
                    {t.supplier}
                  </th>
                  <th scope="col" className={heading}>
                    {t.manufacturerPart}
                  </th>
                  <th scope="col" className={heading}>
                    {t.packQuantity}
                  </th>
                  <th scope="col" className={heading}>
                    {t.orderedUnits}
                  </th>
                  {pricing !== undefined && (
                    <th scope="col" className={heading}>
                      {t.pricePerPack}
                    </th>
                  )}
                  {showActions && (
                    <th scope="col" className={heading}>
                      {t.actions}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {workspace.offers.map((offer) => {
                  const manufacturer =
                    offer.manufacturerPartId === null
                      ? undefined
                      : manufacturers.get(offer.manufacturerPartId);
                  const units = calculateStockUnits(packs, offer.packQuantity);
                  const tier =
                    offer.approved && offer.available && pricing !== undefined && units !== null
                      ? chooseSourcingTier(pricing.tiers, offer.id, currency, packs)
                      : null;
                  return (
                    <tr key={offer.id} data-sourcing-offer-id={offer.id}>
                      <td className={cell}>
                        <div className="font-medium">
                          <bdi>{offer.supplierName}</bdi>
                        </div>
                        <div className="text-muted-foreground">
                          <bdi className="break-all">{offer.partNumber}</bdi>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="outline">
                            {offer.approved ? t.approved : t.unapproved}
                          </Badge>
                          <Badge variant="outline">
                            {offer.available ? t.available : t.unavailableOffer}
                          </Badge>
                        </div>
                      </td>
                      <td className={cell}>
                        {manufacturer === undefined ? (
                          "—"
                        ) : (
                          <bdi>
                            {manufacturer.organizationName} · {manufacturer.partNumber}
                          </bdi>
                        )}
                      </td>
                      <td className={cell}>
                        <bdi>
                          {number(offer.packQuantity)} {offer.stockUnit}
                        </bdi>
                      </td>
                      <td className={cell} data-sourcing-order-units={units ?? undefined}>
                        {units === null ? (
                          "—"
                        ) : (
                          <bdi>
                            {number(units)} {offer.stockUnit}
                          </bdi>
                        )}
                      </td>
                      {pricing !== undefined && (
                        <td className={cell}>
                          {tier === null ? (
                            <span className="text-muted-foreground">{t.noPrice}</span>
                          ) : (
                            <>
                              <Money value={tier} />
                              <p className="text-xs text-muted-foreground">
                                {t.minimumPacks} {number(tier.minPacks)}
                              </p>
                            </>
                          )}
                        </td>
                      )}
                      {showActions && (
                        <td className={cell}>
                          <div className="flex flex-wrap gap-1.5">
                            {canBuy && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={(event) => open(event, { type: "offer", row: offer })}
                              >
                                {t.editOffer}
                              </Button>
                            )}
                            {pricing !== undefined && (
                              <Button
                                size="sm"
                                variant={selectedOffer?.id === offer.id ? "outline" : "ghost"}
                                disabled={busy}
                                aria-expanded={selectedOffer?.id === offer.id}
                                aria-controls={selectedOffer?.id === offer.id ? tiersId : undefined}
                                onClick={() => selectOffer(offer)}
                              >
                                {pricingAction}
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selectedOffer !== undefined && pricing !== undefined && (
            <PriceTiers
              id={tiersId}
              canEdit={canEditPrices}
              busy={busy}
              offer={selectedOffer}
              tiers={pricing.tiers.filter(({ offerId }) => offerId === selectedOffer.id)}
              open={open}
              t={t}
            />
          )}
        </>
      )}
    </section>
  );
}

function PriceTiers({
  id,
  offer,
  tiers,
  canEdit,
  busy,
  open,
  t,
}: {
  id: string;
  offer: SourcingOffer;
  tiers: SourcingPriceTier[];
  canEdit: boolean;
  busy: boolean;
  open: OpenEditor;
  t: SourcingMessages;
}) {
  const { number } = useFormatters();
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className="space-y-3 border-t p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="font-semibold">
            {t.priceTiers}
          </h3>
          <p className="text-sm text-muted-foreground">
            <bdi>
              {offer.supplierName} · {offer.partNumber}
            </bdi>
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={(event) => open(event, { type: "tier", offer, tier: null })}
          >
            {t.addTier}
          </Button>
        )}
      </div>
      {tiers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noTiers}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {tiers.map((tier) => (
            <li
              key={`${tier.currency}:${tier.minPacks}`}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">
                  <Money value={tier} />
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.minimumPacks} {number(tier.minPacks)}
                </p>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={(event) => open(event, { type: "tier", offer, tier })}
                  >
                    {t.editTier}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={(event) => open(event, { type: "removeTier", tier })}
                  >
                    {t.removeTier}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CostOverride({
  cost,
  canEdit,
  busy,
  open,
  t,
}: {
  cost: SourcingMoney | null;
  canEdit: boolean;
  busy: boolean;
  open: OpenEditor;
  t: SourcingMessages;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <SectionHeading title={t.costOverride}>
        {canEdit && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={(event) => open(event, { type: "override", cost })}
            >
              {t.setOverride}
            </Button>
            {cost !== null && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={(event) => open(event, { type: "removeOverride" })}
              >
                {t.removeOverride}
              </Button>
            )}
          </div>
        )}
      </SectionHeading>
      {cost === null ? (
        <Empty>{t.noOverride}</Empty>
      ) : (
        <p className="px-3 pb-3 text-sm" data-sourcing-cost-override>
          <Money value={cost} />
        </p>
      )}
    </section>
  );
}

export function SourcingView({
  workspace,
  busy,
  open,
  t,
}: {
  workspace: Workspace;
  busy: boolean;
  open: OpenEditor;
  t: SourcingMessages;
}) {
  const [activeOfferId, setActiveOfferId] = useState<string | null>(null);
  const selectedOffer = workspace.offers.find(({ id }) => id === activeOfferId);
  const site = workspace.sites.find(({ id }) => id === workspace.selectedSiteId);
  const part = workspace.parts.find(({ id }) => id === workspace.selectedItemId);
  if (site === undefined || part === undefined) return null;
  const canBuy = site.canBuy && !site.archived && part.canSource;
  const canEditPrices = site.canEditCosts && !site.archived && part.canSource;
  const pricing = site.canViewCosts ? workspace.pricing : undefined;

  return (
    <div className="space-y-4">
      {site.archived && <p className="text-sm text-muted-foreground">{t.readOnlySite}</p>}
      {!part.canSource && <p className="text-sm text-muted-foreground">{t.inactivePart}</p>}
      {canBuy && workspace.organizations.length === 0 && (
        <p className="text-sm text-muted-foreground">{t.noOrganizations}</p>
      )}
      <Manufacturers {...{ workspace, canBuy, busy, open, t }} />
      <Offers
        {...{ workspace, pricing, canBuy, canEditPrices, busy, open, selectedOffer, t }}
        selectOffer={(offer) =>
          setActiveOfferId((previous) => (previous === offer.id ? null : offer.id))
        }
      />
      {pricing !== undefined && (
        <CostOverride cost={pricing.override} canEdit={canEditPrices} {...{ busy, open, t }} />
      )}
    </div>
  );
}
