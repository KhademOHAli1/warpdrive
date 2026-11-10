import type { TemplateManifest } from "./templateManifestSchemas";

type DependencyNode = Readonly<{ id: string; dependsOn: readonly string[] }>;

function validDependencyGraph(nodes: readonly DependencyNode[]): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (
    nodes.some(
      (node) =>
        new Set(node.dependsOn).size !== node.dependsOn.length ||
        node.dependsOn.some((id) => !byId.has(id)),
    )
  )
    return false;
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function cyclic(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if (byId.get(id)?.dependsOn.some(cyclic) === true) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  return !nodes.some((node) => cyclic(node.id));
}

function sameOrEarlierStage(
  dependencyStageId: string,
  stageId: string,
  stages: ReadonlyMap<string, DependencyNode>,
): boolean {
  const remaining = [stageId];
  const visited = new Set<string>();
  while (remaining.length > 0) {
    const id = remaining.pop();
    if (id === undefined) return false;
    if (id === dependencyStageId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    remaining.push(...(stages.get(id)?.dependsOn ?? []));
  }
  return false;
}

// Schemas bound the graph before this semantic pass. There is no task execution here.
export function validTemplateManifestGraph(manifest: TemplateManifest): boolean {
  const entities = [
    ...manifest.roles,
    ...manifest.stages,
    ...manifest.deliverables,
    ...manifest.intents,
  ];
  if (new Set(entities.map((entity) => entity.id)).size !== entities.length) return false;
  if (!validDependencyGraph(manifest.stages) || !validDependencyGraph(manifest.intents))
    return false;
  const roles = new Map(manifest.roles.map((role) => [role.id, role.kind]));
  const stages = new Map(manifest.stages.map((stage) => [stage.id, stage]));
  const deliverables = new Map(
    manifest.deliverables.map((deliverable) => [deliverable.id, deliverable]),
  );
  const intents = new Map(manifest.intents.map((intent) => [intent.id, intent]));
  if (
    manifest.deliverables.some(
      (deliverable) =>
        !stages.has(deliverable.stageId) ||
        roles.get(deliverable.responsibleRoleId) !== "internal-producer",
    )
  )
    return false;
  return manifest.intents.every((intent) => {
    if (!stages.has(intent.stageId)) return false;
    if (intent.kind === "assignment") {
      if (
        roles.get(intent.internalProducerRoleId) !== "internal-producer" ||
        roles.get(intent.freelancerRoleId) !== "freelancer-contact"
      )
        return false;
    } else if (roles.get(intent.assigneeRoleId) !== "internal-producer") return false;
    if (intent.kind !== "follow-up") {
      const deliverable = deliverables.get(intent.deliverableId);
      if (
        deliverable === undefined ||
        !sameOrEarlierStage(deliverable.stageId, intent.stageId, stages)
      )
        return false;
    }
    return intent.dependsOn.every((id) => {
      const dependency = intents.get(id);
      return (
        dependency !== undefined && sameOrEarlierStage(dependency.stageId, intent.stageId, stages)
      );
    });
  });
}
