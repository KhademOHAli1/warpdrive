import { classifyInventory } from "./registryClassification";

export const assetAuditsEntry = classifyInventory(
  [
    "derived:src/features/assets/audits/EquipmentAuditsFixture.tsx",
    "derived:src/features/assets/audits/contracts.ts",
    "derived:src/features/assets/audits/projection.ts",
    "derived:src/features/assets/audits/snapshot.ts",
    "derived:src/features/assets/audits/transitions.ts",
    "derived:src/features/assets/audits/ui/AuditCountDialogs.tsx",
    "derived:src/features/assets/audits/ui/AuditDialog.tsx",
    "derived:src/features/assets/audits/ui/AuditDraftDialog.tsx",
    "derived:src/features/assets/audits/ui/EquipmentAuditsWorkspace.tsx",
    "sourceReview:src/app/(app)/assets/audits/page.tsx#7842adc37a8462c76b93ac1291f98fd32b83a2a0f2d08cd0d61093702e6b96ad",
    "sourceReview:src/features/assets/audits/EquipmentAuditsFixture.tsx#cb16e0d27836aab42e76c14466f6588483f4f5f5833fcb2f5d551fd838b368e4",
    "sourceReview:src/features/assets/audits/contracts.ts#b62b416fe1f6638339977b76f27bb5a9fa3368d01869bd83c3edd4a593bc4469",
    "sourceReview:src/features/assets/audits/fixtureData.ts#9d27a9491468016f5974ab0f864e15ab66624110907cf48aaad1cb8b2a169232",
    "sourceReview:src/features/assets/audits/fixturePhoto.ts#3f39fd6e6db51e5ccaab125c0e95fd1486d97e1c1aa9495a1e5ba4b74e6cd377",
    "sourceReview:src/features/assets/audits/projection.ts#eb609e1fbb3854261e3df84dc431f5f9ada1510d13e4c8cec8f5d6a362c7e7e5",
    "sourceReview:src/features/assets/audits/snapshot.ts#5b5dda545750c708208821bab45da39e65cd6879fec9c82e08ff9f7b422d088b",
    "sourceReview:src/features/assets/audits/state.ts#f0b5e9f97c7f47f46b06fc0bf2d51584bb1ef4f00dfc607c5a4e05251d5912e1",
    "sourceReview:src/features/assets/audits/transitions.ts#8d4c980fd2e7d20dd15bec48366991fbc4dcd6180c7a78576731fab4a054f5d4",
    "sourceReview:src/features/assets/audits/ui/AuditCountDialogs.tsx#f30f204b61f86400e1c44adba0283f990e64a8a2bf53eca647a5a48be3326a57",
    "sourceReview:src/features/assets/audits/ui/AuditDetail.tsx#caf596e4e47965bf4ed112afb2c7a131d3f08979649c83755a576e9dfdebb17b",
    "sourceReview:src/features/assets/audits/ui/AuditDialog.tsx#f5c26daff9d517ad663cf07c44d85d2a58ca48887f529e4fb02de8c28b5a0782",
    "sourceReview:src/features/assets/audits/ui/AuditDocuments.tsx#2bfd06313566f88f429b1b28c57baa90e7967be81ea33649797bdf5f95803cc4",
    "sourceReview:src/features/assets/audits/ui/AuditDraftDialog.tsx#32fd8e001edd9e8c852afd0aba5eccef7cefb268cc22fbbacbd19675958a1a60",
    "sourceReview:src/features/assets/audits/ui/AuditTaskDialog.tsx#ea93192fe5db6a5e6b07d89989f76ac3639eca2f56cf1f71f28083a2d418b50b",
    "sourceReview:src/features/assets/audits/ui/EquipmentAuditsLink.tsx#7fe2487d0cc8a871b9738fad7957690099d92cfbd4141c282fc95c75b5346615",
    "sourceReview:src/features/assets/audits/ui/EquipmentAuditsWorkspace.tsx#b8f27e351c2d933d09e5fdf5d68a399ecacb167d7811ceb199fd2a762dc0907a",
    "sourceReview:src/features/assets/audits/ui/auditView.ts#4cd59e516b2f840398a027dd8eb2fb9e95cc2a708f1c25a8c3901ffa618fe074",
    "sourceReview:src/features/assets/audits/ui/messages.ts#8769d40754b8f87c4ee70e9aa3d5b01ad170db008118e180650cab82cf1809f8",
    "writer:src/features/assets/audits/ui/AuditDialog.tsx#delete:dynamic",
    "writer:src/features/assets/audits/ui/EquipmentAuditsWorkspace.tsx#write:none",
  ],
  {
    owner: "site-scoped physical equipment audits",
    categories: [
      "site, frozen equipment identities and placements, expected and observed quantities",
      "assigned auditors, attributed observations, corrections and review history",
      "private equipment photographs and audit notes",
    ],
    subjectRelation:
      "Audits assign named operators to a site count and attribute evidence to the active audit and observation.",
    purpose:
      "Reconcile observed equipment against the frozen audit scope, preserve discrepancies and evidence, and give operators an authorized audit report.",
    disclosure:
      "Site managers and current assigned auditors see the authorized audit projection. Assigned auditors cannot use scan results to browse the live register. Audit details and evidence are masked from replay.",
    retention:
      "Demo audit observations and browser-local photo URLs remain in memory for the current view.",
    externalEffects:
      "The fixture can render an A4 report and download an activity CSV. It sends no audit transaction to Core.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
