import { useId, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { ConfigurationIssue, ConfigurationMetadata } from "../configurationTypes";
import {
  type BranchPort,
  branchPort,
  type IfElseBranch,
  type IfElseConfig,
  ifElseBranchLimit,
  newIfElseBranch,
  parseIfElseConfig,
  projectIfElsePredicate,
} from "../ifElse";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { ConditionGroupFields } from "./ConditionGroupFields";
import styles from "./IfElseConfigurationFields.module.css";
import { WorkflowReferenceIcon } from "./WorkflowReferenceIcon";

type Props = {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  onRemoveConnectedRoute?: (node: WorkflowNode, port: BranchPort) => void;
  metadata?: ConfigurationMetadata;
  issues?: readonly ConfigurationIssue[];
};

type RouteProps = Pick<Props, "definition" | "node" | "editable" | "metadata" | "issues"> & {
  branch: IfElseBranch;
  index: number;
  removalBlocked: boolean;
  onPredicateChange: (predicate: WorkflowNode["config"]) => void;
  onRemove: () => void;
};

function RouteFields({
  definition,
  node,
  editable,
  metadata,
  issues,
  branch,
  index,
  removalBlocked,
  onPredicateChange,
  onRemove,
}: RouteProps) {
  const t = useAppTranslations("workflows");
  const { number } = useFormatters();
  const titleId = useId();
  const reasonId = useId();
  const projected = projectIfElsePredicate(definition, node.id, branch.predicate);
  const condition = projected.nodes.find((item) => item.id === node.id);
  if (condition === undefined) return null;
  const routeNumber = number(index);
  const title = index === 0 ? t("ifElseIf") : t("ifElseElseIf", { number: routeNumber });
  const branchIssues = issues
    ?.filter(
      ({ path }) => path[0] === "branches" && path[1] === String(index) && path[2] === "predicate",
    )
    .map((issue) => ({ ...issue, path: issue.path.slice(3) }));
  return (
    <section aria-labelledby={titleId} className={styles.route}>
      <h3 id={titleId} className={styles.routeTitle}>
        {title}
      </h3>
      <ConditionGroupFields
        definition={projected}
        node={condition}
        editable={editable}
        metadata={metadata}
        issues={branchIssues}
        showOtherwise={false}
        onChange={(changed) => onPredicateChange(changed.config)}
      />
      {editable && index > 0 && (
        <div className={styles.routeActions}>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("ifElseRemoveRouteLabel", { number: routeNumber })}
            aria-describedby={removalBlocked ? reasonId : undefined}
            disabled={removalBlocked}
            onClick={onRemove}
          >
            <WorkflowReferenceIcon name="trash" size={14} />
            {t("ifElseRemoveRoute")}
          </Button>
          {removalBlocked && (
            <p id={reasonId} className={styles.hint}>
              {t("ifElseDisconnectRoute")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function IfElseConfigurationFields(props: Props) {
  const { node, definition, metadata, onChange, onRemoveConnectedRoute } = props;
  const t = useAppTranslations("workflows");
  const titleId = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const editable = props.editable && metadata?.status !== "denied";
  const parsed = parseIfElseConfig(node.config, "draft");
  if (!parsed.ok)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("ifElseInvalidRoutes")}
      </p>
    );
  const { branches, fallbackId } = parsed.value;
  const connected = new Set<string>(
    definition.edges.filter((edge) => edge.from === node.id).map((edge) => edge.port),
  );

  function updatedNode(config: IfElseConfig): WorkflowNode | undefined {
    const next = parseIfElseConfig(config, "draft");
    return editable && next.ok ? { ...node, config: next.value } : undefined;
  }
  function commit(next: IfElseBranch[]) {
    const changed = updatedNode({ branches: next, fallbackId });
    if (changed !== undefined) onChange(changed);
  }
  function addRoute() {
    if (editable && branches.length < ifElseBranchLimit)
      commit([...branches, newIfElseBranch(`route_${crypto.randomUUID()}`)]);
  }
  function removeRoute(id: string) {
    const changed = updatedNode({
      branches: branches.filter((branch) => branch.id !== id),
      fallbackId,
    });
    if (changed === undefined) return;
    const port = branchPort(id);
    if (connected.has(port)) {
      if (onRemoveConnectedRoute === undefined) return;
      onRemoveConnectedRoute(changed, port);
    } else onChange(changed);
    queueMicrotask(() => addButton.current?.focus());
  }

  return (
    <section aria-labelledby={titleId} className={styles.conditions}>
      <h3 id={titleId} className={styles.label}>
        {t("ifElseConditions")}
      </h3>
      <p className={styles.hint}>{t("ifElseFirstMatch")}</p>
      {branches.map((branch, index) => (
        <RouteFields
          key={branch.id}
          definition={definition}
          node={node}
          editable={editable}
          metadata={metadata}
          issues={props.issues}
          branch={branch}
          index={index}
          removalBlocked={
            connected.has(branchPort(branch.id)) && onRemoveConnectedRoute === undefined
          }
          onPredicateChange={(predicate) =>
            commit(branches.map((item) => (item.id === branch.id ? { ...item, predicate } : item)))
          }
          onRemove={() => removeRoute(branch.id)}
        />
      ))}
      {editable && (
        <div className={styles.addRoute}>
          <Button
            ref={addButton}
            size="sm"
            variant="outline"
            disabled={branches.length >= ifElseBranchLimit}
            onClick={addRoute}
          >
            <WorkflowReferenceIcon name="plus" size={14} />
            {t("ifElseAddRoute")}
          </Button>
          {branches.length >= ifElseBranchLimit && (
            <p className={styles.hint}>{t("ifElseRouteLimit", { limit: ifElseBranchLimit })}</p>
          )}
        </div>
      )}
      <p className={styles.hint}>{t("ifElseFallback")}</p>
    </section>
  );
}
