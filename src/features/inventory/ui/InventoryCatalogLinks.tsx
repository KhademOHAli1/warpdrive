"use client";

import { ClipboardList, LibraryBig, ListTree, Truck, Warehouse } from "lucide-react";
import Link from "next/link";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { LocationDirectoryLink } from "@/features/locations/LocationDirectoryLink";
import { trpc } from "@/lib/trpc-client";
import { bomMessages } from "../bom/ui/messages";
import { catalogMessages } from "../catalog/ui/catalogMessages";
import { purchaseMessages } from "../purchasing/ui/messages";
import { sourcingMessages } from "../sourcing/ui/messages";
import { warehouseMessages } from "../warehouse/ui/warehouseMessages";

const linkStyle =
  "inline-flex items-center gap-2 border-b-2 border-transparent px-2 py-2 text-sm font-medium text-muted-foreground hover:text-foreground";

function SourcingCatalogLink() {
  const locale = useLocale();
  const scope = trpc.operationsAccess.scope.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: "always",
  });
  const canSource =
    scope.data?.ok === true &&
    scope.data.value.sites.some(({ canBuy, canViewCosts }) => canBuy || canViewCosts);
  if (!canSource) return null;
  return (
    <Link href="/inventory/sourcing" prefetch={false} className={linkStyle}>
      <Truck aria-hidden="true" className="size-4" /> {sourcingMessages[locale].title}
    </Link>
  );
}

function PurchaseOrdersLink() {
  const locale = useLocale();
  const scope = trpc.inventory.purchasing.scope.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: "always",
  });
  if (scope.isError || scope.data?.ok !== true || scope.data.value.sites.length === 0) return null;
  return (
    <Link href="/inventory/purchase-orders" prefetch={false} className={linkStyle}>
      <ClipboardList aria-hidden="true" className="size-4" /> {purchaseMessages[locale].title}
    </Link>
  );
}

export function InventoryCatalogLinks({ fixture = false }: { fixture?: boolean }) {
  const locale = useLocale();
  return (
    <>
      <Link href="/inventory/catalog" prefetch={false} className={linkStyle}>
        <LibraryBig aria-hidden="true" className="size-4" /> {catalogMessages[locale].title}
      </Link>
      <Link href="/inventory/warehouse" prefetch={false} className={linkStyle}>
        <Warehouse aria-hidden="true" className="size-4" /> {warehouseMessages[locale].title}
      </Link>
      {!fixture && (
        <>
          <Link href="/inventory/bom" prefetch={false} className={linkStyle}>
            <ListTree aria-hidden="true" className="size-4" /> {bomMessages[locale].title}
          </Link>
          <SourcingCatalogLink />
          <PurchaseOrdersLink />
        </>
      )}
      <LocationDirectoryLink />
    </>
  );
}
