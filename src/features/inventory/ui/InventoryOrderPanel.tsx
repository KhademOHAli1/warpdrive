import { Check, Circle, ExternalLink, RefreshCw, Truck } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { cn } from "@/lib/utils";
import type { InventoryItem, InventoryOrder, InventoryWorkspace } from "../contracts";
import type { FormatQuantity, RunInventoryIntent } from "./InventoryClient";
import { inventoryMessages } from "./inventoryMessages";

const mask = `${BLOCK_CLASS} ph-no-capture`;
export function InventoryOrderForm({
  deal,
  items,
  run,
  pending,
}: {
  deal: NonNullable<InventoryWorkspace["deal"]>;
  items: InventoryItem[];
  run: RunInventoryIntent;
  pending: boolean;
}) {
  const t = inventoryMessages[useLocale()];
  const formId = useId();
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const products = items.filter(({ kind }) => kind === "product");
  return (
    <section className="rounded-lg border bg-card" aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`} className="border-b px-4 py-3 text-sm font-semibold">
        {t.newOrder}
      </h2>
      {products.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{t.noProducts}</p>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const amount = Number(quantity);
            if (itemId === "" || !Number.isSafeInteger(amount) || amount <= 0) return;
            void run({ type: "place", dealId: deal.id, itemId, quantity: amount }).then(
              (updated) => {
                if (updated !== null) setQuantity("1");
              },
            );
          }}
        >
          <div className="grid w-full max-w-md gap-1 text-sm sm:w-auto sm:min-w-64">
            <span>{t.orderItem}</span>
            <Select
              ariaLabel={t.orderItem}
              value={itemId}
              options={products.map(({ id, name, sku }) => ({
                value: id,
                label: `${name} (${sku})`,
              }))}
              disabled={pending}
              contentClassName={mask}
              placeholder={t.pickProduct}
              onChange={setItemId}
            />
          </div>
          <label htmlFor={`${formId}-quantity`} className="grid w-28 gap-1 text-sm">
            {t.orderQuantity}
            <Input
              id={`${formId}-quantity`}
              type="number"
              min={1}
              max={1_000_000}
              required
              value={quantity}
              disabled={pending}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={pending || itemId === ""}>
            {t.placeOrder}
          </Button>
        </form>
      )}
    </section>
  );
}

type QueueProps = {
  workspace: InventoryWorkspace;
  quantity: FormatQuantity;
  pending: boolean;
  run: RunInventoryIntent;
};

export function InventoryOrderQueue({
  workspace,
  refresh,
  ...props
}: QueueProps & { refresh?: () => void }) {
  const t = inventoryMessages[useLocale()];
  const queueId = useId();
  return (
    <section className="space-y-3" aria-labelledby={queueId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold" id={queueId}>
          {workspace.deal === null ? t.queue : t.dealOrders}
        </h2>
        {refresh !== undefined && (
          <Button size="sm" variant="outline" disabled={props.pending} onClick={refresh}>
            <RefreshCw className="size-4" aria-hidden="true" /> {t.refreshOrders}
          </Button>
        )}
      </div>
      {workspace.orders.length === 0 ? (
        <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
          {workspace.deal === null ? t.noOrders : t.noDealOrders}
        </div>
      ) : (
        <div className="grid items-start gap-3 xl:grid-cols-2">
          {workspace.orders.map((order) => (
            <InventoryOrderCard key={order.id} order={order} workspace={workspace} {...props} />
          ))}
        </div>
      )}
    </section>
  );
}

function InventoryOrderCard({
  order,
  workspace,
  quantity,
  pending,
  run,
}: QueueProps & { order: InventoryOrder }) {
  const t = inventoryMessages[useLocale()];
  const titleId = useId();
  const [confirm, setConfirm] = useState(false);
  const item = workspace.items.find(({ id }) => id === order.itemId);
  const project = workspace.projects.find(({ id }) => id === order.projectId);
  const open = order.status !== "cancelled" && order.status !== "shipped";
  const projectHref =
    !workspace.fixture && order.projectId !== null
      ? `/projects/internal/${encodeURIComponent(order.projectId)}`
      : null;
  const incomplete = order.tasks.some(({ done }) => !done);
  const mayComplete =
    workspace.fixture || (order.projectId !== null && order.tasks.length > 0 && !incomplete);
  const orderRef = { orderId: order.id, revision: order.revision };

  return (
    <article aria-labelledby={titleId} className="min-w-0 rounded-lg border bg-card">
      <header className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h3 id={titleId} className="wrap-anywhere text-sm font-semibold">
            <bdi>{item?.name ?? t.orderUnavailable}</bdi>
          </h3>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {item !== undefined && <bdi dir="ltr">{item.sku}</bdi>}
            <bdi dir="ltr">#{order.id.slice(0, 8)}</bdi>
            {workspace.deal === null && order.dealId !== null && !workspace.fixture && (
              <Link
                className="text-action hover:underline"
                href={`/deals/${encodeURIComponent(order.dealId)}`}
              >
                {t.openDeal}
              </Link>
            )}
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn("shrink-0", order.status === "ready" && "bg-success/10 text-success")}
        >
          {t[order.status]}
        </Badge>
      </header>
      <div className="space-y-3 p-4">
        <dl className="grid grid-cols-3 gap-2 text-sm">
          {(
            [
              [t.ordered, order.quantity],
              [t.reserved, order.reserved],
              [t.buildQuantity, order.buildQuantity],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-md bg-muted/30 px-2.5 py-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{quantity(value)}</dd>
            </div>
          ))}
        </dl>
        {order.materials.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-medium">{t.materials}</h4>
            <ul className="divide-y text-sm">
              {order.materials.map(({ itemId, quantity: count }) => {
                const component = workspace.items.find(({ id }) => id === itemId);
                const remaining =
                  component === undefined ? 0 : component.onHand - component.reserved;
                const short = order.status === "awaiting_materials" && remaining < count;
                return (
                  <li
                    key={itemId}
                    className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                  >
                    <bdi>{component?.name ?? t.materialUnavailable}</bdi>
                    <span
                      className={cn(
                        "tabular-nums text-muted-foreground",
                        short && "text-destructive",
                      )}
                    >
                      {t.required} {quantity(count)}
                      {short ? ` · ${t.available} ${quantity(remaining)}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {(projectHref !== null || order.tasks.length > 0) && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-medium">{t.productionTasks}</h4>
              {projectHref !== null && (
                <Link
                  href={projectHref}
                  className="inline-flex items-center gap-1 text-xs text-action hover:underline"
                >
                  {project?.title ?? t.openProject}
                  <ExternalLink className="size-3" aria-hidden="true" />
                </Link>
              )}
            </div>
            <ul className="space-y-1 text-sm">
              {order.tasks.map((task) => (
                <li key={task.id} className="flex items-center gap-2">
                  {task.done ? (
                    <Check className="size-4 shrink-0 text-success" aria-label={t.done} />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground" aria-label={t.open} />
                  )}
                  {projectHref === null ? (
                    <bdi>{task.title}</bdi>
                  ) : (
                    <Link
                      href={`${projectHref}?item=${encodeURIComponent(task.id)}`}
                      className="text-action hover:underline"
                    >
                      <bdi>{task.title}</bdi>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {open && workspace.canManage && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            {order.status === "awaiting_materials" && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => void run({ type: "reserveMaterials", ...orderRef })}
              >
                {t.reserveButton}
              </Button>
            )}
            {order.status === "in_production" && mayComplete && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => void run({ type: "completeBuild", ...orderRef })}
              >
                {t.buildButton}
              </Button>
            )}
            {order.status === "in_production" && !mayComplete && (
              <p className="basis-full text-sm text-muted-foreground">{t.finishTasks}</p>
            )}
            {order.status === "ready" && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => void run({ type: "ship", ...orderRef })}
              >
                <Truck className="size-4" aria-hidden="true" /> {t.shipButton}
              </Button>
            )}
            <AlertDialog
              open={confirm}
              onOpenChange={(next) => {
                if (!pending) setConfirm(next);
              }}
            >
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={pending}>
                  {t.cancelButton}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className={mask}>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t.cancelTitle}</AlertDialogTitle>
                  <AlertDialogDescription>{t.cancelDescription}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={pending}>{t.keepOrder}</AlertDialogCancel>
                  <Button
                    variant="destructive"
                    disabled={pending}
                    onClick={() => {
                      void run({ type: "cancel", ...orderRef }).then(() => setConfirm(false));
                    }}
                  >
                    {t.cancelButton}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </article>
  );
}
