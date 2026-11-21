import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { type ComponentType, type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type { InventoryItem, InventoryWorkspace } from "../contracts";
import type { FormatQuantity, RunInventoryIntent } from "./InventoryClient";
import { inventoryMessages } from "./inventoryMessages";

const mask = `${BLOCK_CLASS} ph-no-capture`;
const skuPattern = "[A-Za-z0-9][A-Za-z0-9_.\\-]{0,39}";

export function InventoryNewItem({
  items,
  pending,
  error,
  run,
  onClose,
  onCreated,
}: {
  items: InventoryItem[];
  pending: boolean;
  error: string | null;
  run: RunInventoryIntent;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = inventoryMessages[useLocale()];
  const formId = useId();
  const kindOptions = [
    { value: "component", label: t.component },
    { value: "product", label: t.product },
  ];
  const [kind, setKind] = useState<InventoryItem["kind"]>("component");
  const [bom, setBom] = useState<{ key: string; itemId: string; quantity: number }[]>([]);
  const components = items.filter((item) => item.kind === "component");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawSku = form.get("sku");
    const rawRevision = form.get("revision");
    const name = form.get("name");
    if (typeof rawSku !== "string" || typeof rawRevision !== "string" || typeof name !== "string")
      return;
    const sku = rawSku.trim().toUpperCase();
    const revision = rawRevision.trim();
    void run({
      type: "createItem",
      sku,
      revision,
      name: name.trim(),
      kind,
      bom: kind === "component" ? [] : bom.map(({ itemId, quantity }) => ({ itemId, quantity })),
    }).then((updated) => {
      if (updated === null) return;
      const item = updated.items.find((row) => row.sku === sku && row.revision === revision);
      if (item !== undefined) onCreated(item.id);
      onClose();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent className={`${mask} max-h-[90dvh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle>{t.newItem}</DialogTitle>
          <DialogDescription>{t.newDescription}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {error !== null && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <label htmlFor={`${formId}-name`} className="grid gap-1 text-sm">
            {t.itemName}
            <Input id={`${formId}-name`} name="name" required maxLength={120} disabled={pending} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor={`${formId}-sku`} className="grid gap-1 text-sm">
              {t.sku}
              <Input
                id={`${formId}-sku`}
                dir="ltr"
                name="sku"
                required
                pattern={skuPattern}
                maxLength={40}
                disabled={pending}
              />
            </label>
            <label htmlFor={`${formId}-revision`} className="grid gap-1 text-sm">
              {t.revision}
              <Input
                id={`${formId}-revision`}
                name="revision"
                required
                defaultValue="A"
                maxLength={20}
                disabled={pending}
              />
            </label>
          </div>
          <div className="grid gap-1 text-sm">
            <span>{t.itemType}</span>
            <Select
              ariaLabel={t.itemType}
              value={kind}
              options={kindOptions}
              contentClassName={mask}
              onChange={(value) => setKind(value === "product" ? "product" : "component")}
              disabled={pending}
            />
          </div>
          {kind === "product" && (
            <fieldset className="space-y-2 border-t pt-3" disabled={pending}>
              <legend className="text-sm font-medium">{t.bom}</legend>
              {bom.map((line, index) => {
                const available = components.filter(
                  ({ id }) => id === line.itemId || !bom.some((row) => row.itemId === id),
                );
                return (
                  <div
                    key={line.key}
                    className="grid grid-cols-[minmax(0,1fr)_5rem_auto] items-end gap-2"
                  >
                    <div className="grid min-w-0 gap-1 text-sm">
                      <span>{t.component}</span>
                      <Select
                        ariaLabel={`${t.component} ${index + 1}`}
                        value={line.itemId}
                        options={available.map(({ id, name, sku }) => ({
                          value: id,
                          label: `${name} (${sku})`,
                        }))}
                        contentClassName={mask}
                        onChange={(itemId) =>
                          setBom((rows) =>
                            rows.map((row) => (row.key === line.key ? { ...row, itemId } : row)),
                          )
                        }
                        disabled={pending}
                      />
                    </div>
                    <label htmlFor={`${formId}-${line.key}`} className="grid gap-1 text-sm">
                      {t.quantity}
                      <Input
                        id={`${formId}-${line.key}`}
                        aria-label={`${t.materialQuantity} ${index + 1}`}
                        type="number"
                        min={1}
                        max={1_000_000}
                        required
                        defaultValue={1}
                        onChange={(event) => {
                          const quantity = event.target.valueAsNumber;
                          setBom((rows) =>
                            rows.map((row) => (row.key === line.key ? { ...row, quantity } : row)),
                          );
                        }}
                      />
                    </label>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t.removeMaterial} ${index + 1}`}
                      onClick={() => setBom((rows) => rows.filter((row) => row.key !== line.key))}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                );
              })}
              {components.length > bom.length && bom.length < 30 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const next = components.find(
                      ({ id }) => !bom.some(({ itemId }) => itemId === id),
                    );
                    if (next !== undefined)
                      setBom([...bom, { key: crypto.randomUUID(), itemId: next.id, quantity: 1 }]);
                  }}
                >
                  <Plus aria-hidden="true" className="size-4" /> {t.addMaterial}
                </Button>
              )}
              {components.length === 0 && (
                <p className="text-sm text-muted-foreground">{t.createComponent}</p>
              )}
            </fieldset>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              {t.close}
            </Button>
            <Button type="submit" disabled={pending}>
              {t.addItem}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type InventoryProductReleases = ComponentType<{ item: InventoryItem }>;

export function InventorySelectedItem({
  item,
  workspace,
  quantity,
  pending,
  run,
  ProductReleases,
  openReleases,
}: {
  item: InventoryItem;
  workspace: InventoryWorkspace;
  quantity: FormatQuantity;
  pending: boolean;
  run: RunInventoryIntent;
  ProductReleases?: InventoryProductReleases;
  openReleases: boolean;
}) {
  const t = inventoryMessages[useLocale()];
  const ReleasePanel = item.kind === "product" ? ProductReleases : undefined;
  const receiptId = useId();
  const [receiveQuantity, setReceiveQuantity] = useState("1");
  const details = (
    <div className="space-y-4 p-4">
      <dl className="grid grid-cols-3 gap-2 rounded-md bg-muted/35 p-2.5 text-sm">
        {[
          [t.onHand, item.onHand],
          [t.reserved, item.reserved],
          [t.available, item.onHand - item.reserved],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums">{quantity(Number(value))}</dd>
          </div>
        ))}
      </dl>
      {workspace.canManage && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const amount = Number(receiveQuantity);
            if (!Number.isSafeInteger(amount) || amount <= 0) return;
            void run({ type: "receive", itemId: item.id, quantity: amount }).then((updated) => {
              if (updated !== null) setReceiveQuantity("1");
            });
          }}
        >
          <label htmlFor={receiptId} className="grid min-w-24 flex-1 gap-1 text-sm">
            {t.receiveQuantity}
            <Input
              id={receiptId}
              type="number"
              min={1}
              max={1_000_000}
              required
              value={receiveQuantity}
              onChange={(event) => setReceiveQuantity(event.target.value)}
              disabled={pending}
            />
          </label>
          <Button type="submit" variant="outline" disabled={pending}>
            {t.receiveStock}
          </Button>
        </form>
      )}
      {item.kind === "product" && (
        <>
          <section className="border-t pt-3" aria-label={t.bom}>
            <h3 className="mb-1.5 text-sm font-semibold">{t.bom}</h3>
            {item.bom.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noMaterials}</p>
            ) : (
              <ul className="divide-y text-sm">
                {item.bom.map(({ itemId, quantity: count }) => {
                  const component = workspace.items.find(({ id }) => id === itemId);
                  return (
                    <li key={itemId} className="flex justify-between gap-2 py-1.5">
                      <bdi>{component?.name ?? t.materialUnavailable}</bdi>
                      <span className="tabular-nums text-muted-foreground">{quantity(count)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <InventoryTemplateEditor
            key={JSON.stringify(item.template)}
            item={item}
            workspace={workspace}
            pending={pending}
            run={run}
          />
        </>
      )}
    </div>
  );
  return (
    <section className="min-w-0 rounded-lg border bg-card" aria-label={t.itemDetail}>
      <div className="border-b px-4 py-3">
        <p className="mb-0.5 text-xs text-muted-foreground">
          <bdi dir="ltr">{item.sku}</bdi>
          {ReleasePanel === undefined && (
            <>
              {" "}
              · {t.revision} <bdi>{item.revision}</bdi>
            </>
          )}
        </p>
        <h2 className="font-semibold">
          <bdi>{item.name}</bdi>
        </h2>
      </div>
      {ReleasePanel === undefined ? (
        details
      ) : (
        <Tabs defaultValue={openReleases ? "releases" : "details"}>
          <TabsList aria-label={t.itemDetail} className="gap-1 border-b px-4 py-2">
            <TabsTrigger value="details" className={PILL_TAB}>
              {t.detailsTab}
            </TabsTrigger>
            <TabsTrigger value="releases" className={PILL_TAB}>
              {t.releasesTab}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="mt-0">
            {details}
          </TabsContent>
          <TabsContent value="releases" className="mt-0">
            <ReleasePanel item={item} />
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}

function InventoryTemplateEditor({
  item,
  workspace,
  pending,
  run,
}: {
  item: InventoryItem;
  workspace: InventoryWorkspace;
  pending: boolean;
  run: RunInventoryIntent;
}) {
  const t = inventoryMessages[useLocale()];
  const formId = useId();
  const savedSteps = item.template?.steps.map((step, index) => ({ ...step, key: String(index) }));
  const [projectId, setProjectId] = useState(item.template?.projectId ?? "");
  const [steps, setSteps] = useState(
    () => savedSteps ?? [{ key: "initial", title: "", assigneeId: "" }],
  );
  const project = workspace.projects.find(({ id }) => id === projectId);
  const members = project?.members ?? [];
  const editable = workspace.canManage && workspace.projects.length > 0;
  const valid =
    project !== undefined &&
    steps.every(
      (step) => step.title.trim() !== "" && members.some(({ id }) => id === step.assigneeId),
    );

  return (
    <section className="border-t pt-3" aria-label={t.template}>
      <h3 className="mb-2 text-sm font-semibold">{t.template}</h3>
      {!editable ? (
        item.template === null ? (
          <p className="text-sm text-muted-foreground">{t.noTemplate}</p>
        ) : (
          <div className="space-y-2 text-sm">
            {project !== undefined && (
              <Link
                href={`/projects/internal/${project.id}`}
                className="text-action hover:underline"
              >
                {project.title}
              </Link>
            )}
            <ol className="list-decimal space-y-1 ps-4">
              {savedSteps?.map(({ title, key }) => (
                <li key={key}>
                  <bdi>{title}</bdi>
                </li>
              ))}
            </ol>
          </div>
        )
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid)
              void run({
                type: "saveTemplate",
                itemId: item.id,
                projectId,
                steps: steps.map(({ title, assigneeId }) => ({ title: title.trim(), assigneeId })),
              });
          }}
        >
          <div className="grid gap-1 text-sm">
            <span>{t.productionProject}</span>
            <Select
              ariaLabel={t.productionProject}
              value={projectId}
              placeholder={t.pickProject}
              options={workspace.projects.map(({ id, title }) => ({ value: id, label: title }))}
              contentClassName={mask}
              disabled={pending}
              onChange={(id) => {
                setProjectId(id);
                setSteps((rows) => rows.map((step) => ({ ...step, assigneeId: "" })));
              }}
            />
          </div>
          {steps.map((step, index) => (
            <div
              key={step.key}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2"
            >
              <label htmlFor={`${formId}-${step.key}`} className="grid gap-1 text-sm">
                {t.stepTitle} {index + 1}
                <Input
                  id={`${formId}-${step.key}`}
                  value={step.title}
                  required
                  maxLength={100}
                  disabled={pending}
                  onChange={(event) => {
                    const title = event.target.value;
                    setSteps((rows) =>
                      rows.map((row) => (row.key === step.key ? { ...row, title } : row)),
                    );
                  }}
                />
              </label>
              <div className="grid min-w-0 gap-1 text-sm">
                <span>
                  {t.assignee} {index + 1}
                </span>
                <Select
                  ariaLabel={`${t.assignee} ${index + 1}`}
                  value={step.assigneeId}
                  options={members.map(({ id, name }) => ({ value: id, label: name }))}
                  placeholder={t.pickMember}
                  contentClassName={mask}
                  disabled={pending || members.length === 0}
                  onChange={(assigneeId) =>
                    setSteps((rows) =>
                      rows.map((row) => (row.key === step.key ? { ...row, assigneeId } : row)),
                    )
                  }
                />
              </div>
              {steps.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t.removeStep} ${index + 1}`}
                  disabled={pending}
                  onClick={() => setSteps((rows) => rows.filter((row) => row.key !== step.key))}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              )}
            </div>
          ))}
          {project !== undefined && members.length === 0 && (
            <p className="text-sm text-muted-foreground">{t.noAssignees}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {steps.length < 10 && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  setSteps([...steps, { key: crypto.randomUUID(), title: "", assigneeId: "" }])
                }
              >
                <Plus aria-hidden="true" className="size-4" /> {t.addStep}
              </Button>
            )}
            <Button size="sm" type="submit" disabled={pending || !valid}>
              {t.saveTemplateButton}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
