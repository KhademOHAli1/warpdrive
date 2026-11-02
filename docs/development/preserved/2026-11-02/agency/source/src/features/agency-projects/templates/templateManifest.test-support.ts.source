export function labels(name: string) {
  return { fa: `مدل‌سازی ${name}`, de: `Überprüfung ${name}`, en: `Review ${name}` };
}

export function manifestFixture() {
  const dueOffset = { basis: "calendar-days", anchor: "project-start", days: 2 };
  return {
    schemaVersion: 1,
    templateId: "modeling_project",
    version: 1,
    label: labels("پروژه"),
    description: {
      fa: "راهنمای داخلی",
      de: "Interne Produktionsvorlage",
      en: "Internal production template",
    },
    roles: [
      { id: "producer", kind: "internal-producer", label: labels("تهیه‌کننده") },
      { id: "modeler", kind: "freelancer-contact", label: labels("مدل‌ساز") },
    ] satisfies [unknown, unknown],
    stages: [
      { id: "briefing", label: labels("شرح کار"), dependsOn: [] as string[] },
      { id: "production", label: labels("تولید"), dependsOn: ["briefing"] },
    ] satisfies [unknown, unknown],
    deliverables: [
      { id: "model", label: labels("مدل"), stageId: "production", responsibleRoleId: "producer" },
    ] satisfies [unknown],
    intents: [
      {
        id: "brief_followup",
        kind: "follow-up",
        label: labels("پیگیری"),
        stageId: "briefing",
        assigneeRoleId: "producer",
        dependsOn: [] as string[],
        dueOffset,
      },
      {
        id: "model_assignment",
        kind: "assignment",
        label: labels("همکاری"),
        stageId: "production",
        deliverableId: "model",
        internalProducerRoleId: "producer",
        freelancerRoleId: "modeler",
        dependsOn: ["brief_followup"],
        dueOffset,
      },
      {
        id: "model_review",
        kind: "review",
        label: labels("بازبینی"),
        stageId: "production",
        deliverableId: "model",
        assigneeRoleId: "producer",
        dependsOn: ["model_assignment"],
        dueOffset,
      },
    ] satisfies [unknown, unknown, unknown],
  };
}
