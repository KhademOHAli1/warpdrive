import { classifyInventory } from "./registryClassification";

export const bookingAutomationsEntry = classifyInventory(
  [
    "derived:src/features/assets/bookings/automations/fixture.ts",
    "derived:src/features/assets/bookings/automations/ui/BookingAutomationSettings.tsx",
    "sourceReview:src/features/assets/bookings/automations/BookingAutomationNotices.tsx#f0b3f7d7474907e5ff9cbeff6cfbb10c919ffdae05cd0d270250a490266530d3",
    "sourceReview:src/features/assets/bookings/automations/contracts.ts#8e1a5a683f90c87081bba0de663760f57e5f9af116e91e1dee3acd4a8de3699a",
    "sourceReview:src/features/assets/bookings/automations/fixture.ts#56620c76bbf9259394b4dcb9937b08607f5a0ef54c1c7e5fd2fc516e42f393f6",
    "sourceReview:src/features/assets/bookings/automations/messages.ts#723fc9c9acce94cc72cfbcf79ca5879976ed6f673a857ddf025ecccbc3b50032",
    "sourceReview:src/features/assets/bookings/automations/ui/BookingAutomationSettings.tsx#325cfec31c29976070435acf99392253de857de43924fc73fb654dc64d56349b",
    "sourceReview:src/features/assets/bookings/automations/ui/automationSettingsMessages.ts#4e761177822de1b42f426512e643e51e8bb94e15856f6e3879ad37749659113b",
    "writer:src/features/assets/bookings/automations/ui/BookingAutomationSettings.tsx#delete:signature",
    "writer:src/features/assets/bookings/automations/ui/BookingAutomationSettings.tsx#update:dynamic",
  ],
  {
    owner: "operational booking automations",
    categories: [
      "scoped booking identity, deadline and event references",
      "notification recipient and delivery outcomes",
      "manager rule and recovery receipts",
    ],
    subjectRelation:
      "A notice is for the intended booking requester. Delivery history relates to current site managers.",
    purpose:
      "Notify a current requester about a booking change or deadline, and keep an authorized failure history for recovery.",
    disclosure:
      "Restrict notice reads to the current exact booking requester and delivery history to current site managers. No email or push is sent by the booking fixture.",
    retention:
      "Synthetic booking rules, runs, attempts, and notices stay in the explicit browser fixture and reset on reload.",
    externalEffects:
      "The fixture can open the exact booking and simulate a retry. No live notification or business write occurs.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
