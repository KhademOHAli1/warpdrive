import { classifyInventory } from "./registryClassification";

export const bookingAutomationsEntry = classifyInventory(
  [
    "derived:src/features/assets/bookings/automations/fixture.ts",
    "derived:src/features/assets/bookings/automations/inputs.ts",
    "derived:src/features/assets/bookings/automations/nativeProjection.ts",
    "derived:src/features/assets/bookings/automations/ui/BookingAutomationSettings.tsx",
    "sourceReview:src/features/assets/bookings/automations/BookingAutomationNotices.tsx#68cd280b22bc99aa30e63ce3a18bceeacbd6d59fbd29527db88017a529796ea2",
    "sourceReview:src/features/assets/bookings/automations/actions.backend.ts#d5d97d9d5e1d1996e9ca95ae3f5f1eee53312c2f47ee5806af819694ead5284f",
    "sourceReview:src/features/assets/bookings/automations/contracts.ts#fdc504dc5a52661712b0aa440a011d3f708c9cf8ceaf9a868f7a6df8fab294a3",
    "sourceReview:src/features/assets/bookings/automations/dispatch.ts#9135a20b82d25e30992e46ce15afe808e5c06c610dd4cd28dd73532886d898c5",
    "sourceReview:src/features/assets/bookings/automations/fixture.ts#dfa4bd71beb3b6773f08efa15df73c4d1c7e7d8a740d13751fcb0be60436949c",
    "sourceReview:src/features/assets/bookings/automations/inputs.ts#f179891e4fc2cbc0950eee596cc422f2e6c9e241dd0f8457689eea34e104e248",
    "sourceReview:src/features/assets/bookings/automations/messages.ts#723fc9c9acce94cc72cfbcf79ca5879976ed6f673a857ddf025ecccbc3b50032",
    "sourceReview:src/features/assets/bookings/automations/nativeProjection.ts#70eaf308d2c1004c9a73743ee0b8c91986da145e636430a0170d38dd07d4312c",
    "sourceReview:src/features/assets/bookings/automations/router.ts#2fe9f7896bcc9469b7e0c06ca778c63110c8db949c2e0593163f298022a17ad6",
    "sourceReview:src/features/assets/bookings/automations/schema.ts#d954d2b546f861c5efe98684c595fb94cefac97584dcd46b4f3699d0d10b80d2",
    "sourceReview:src/features/assets/bookings/automations/service.ts#54667f43a8d0722faf1824f8bce1fa432fffe3b7a7d49134f0ea4385527a2162",
    "sourceReview:src/features/assets/bookings/automations/ui/BookingAutomationSettings.tsx#32af856878622b53a459dce514152cb0a5442b712c201bc1fdd5c33a5747028e",
    "sourceReview:src/features/assets/bookings/automations/ui/automationSettingsMessages.ts#4e761177822de1b42f426512e643e51e8bb94e15856f6e3879ad37749659113b",
    "sourceReview:src/features/assets/bookings/automations/webActions.ts#407af1cdea41acadd879b14044d1b2010b3d7c7dd024c36bdf24c4f208f9a68f",
    "table:asset_booking_automation_attempts",
    "table:asset_booking_automation_profiles",
    "table:asset_booking_automation_receipts",
    "table:asset_booking_automation_runs",
    "writer:src/features/assets/bookings/BookingsLive.tsx#query:dynamic",
    "writer:src/features/assets/bookings/BookingsLive.tsx#query:input",
    "writer:src/features/assets/bookings/automations/dispatch.ts#execute:sql",
    "writer:src/features/assets/bookings/automations/dispatch.ts#insert:attempts",
    "writer:src/features/assets/bookings/automations/nativeProjection.ts#execute:sql",
    "writer:src/features/assets/bookings/automations/router.ts#query:dynamic",
    "writer:src/features/assets/bookings/automations/service.ts#insert:profiles",
    "writer:src/features/assets/bookings/automations/service.ts#insert:receipts",
    "writer:src/features/assets/bookings/automations/service.ts#update:\u0000",
    "writer:src/features/assets/bookings/automations/service.ts#update:booking-automation-v1\u0000",
    "writer:src/features/assets/bookings/automations/service.ts#update:dynamic",
    "writer:src/features/assets/bookings/automations/service.ts#update:kind",
    "writer:src/features/assets/bookings/automations/service.ts#update:profiles",
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
      "Core records site rule versions, typed source references, delivery attempts and scoped recovery receipts in PostgreSQL.",
    externalEffects:
      "A registered site worker can deliver in-app notices for current booking events. A current booking manager can retry an exact scoped failure.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
