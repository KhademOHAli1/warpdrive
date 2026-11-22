import { classifyInventory } from "./registryClassification";

export const assetBookingsEntry = classifyInventory(
  [
    "derived:src/features/assets/bookings/BookingsFixture.tsx",
    "derived:src/features/assets/bookings/availability.ts",
    "derived:src/features/assets/bookings/calendar.ts",
    "derived:src/features/assets/bookings/contracts.ts",
    "derived:src/features/assets/bookings/resources.ts",
    "derived:src/features/assets/bookings/transitions.ts",
    "derived:src/features/assets/bookings/ui/BookingRecordEditors.tsx",
    "derived:src/features/assets/bookings/ui/BookingResourceFields.tsx",
    "derived:src/features/assets/bookings/workingHours.ts",
    "sourceReview:src/app/(app)/assets/bookings/page.tsx#d7472436c6186eaa1f4d290e1341a3daaa55899afe8567c6814b4a35f693192e",
    "sourceReview:src/features/assets/bookings/BookingsFixture.tsx#ddc6ba6782b27ec91608c658a9dedc38b8001ef67e2b151c908907c238d6d681",
    "sourceReview:src/features/assets/bookings/availability.ts#548553e34e9765100dc23f7c9789b6a58c5619985b61a8c7d72061185f0d7fe4",
    "sourceReview:src/features/assets/bookings/calendar.ts#95a99e02841e899871f41b25cfb9b9ed02cc9c9599424e9f4177dcd764491b7d",
    "sourceReview:src/features/assets/bookings/contracts.ts#8b19d3d0c65e8465e65758f5948390f93128a0ce1715c8de4ec4931fed206bfd",
    "sourceReview:src/features/assets/bookings/fixtures.ts#2227e1add5edae33ee8b97a33a12402192d404d263ebc4399b5bdfe740b55b75",
    "sourceReview:src/features/assets/bookings/resources.ts#a5f5ddac6c898dd65d4c8d78e6c8a8dac18cdb0c5dd694ec3ef99e55eb8f5e8a",
    "sourceReview:src/features/assets/bookings/transitions.ts#252049b3caf10d4b5220ec978e16df2171fe9c6181df05d403f4ed501208c66d",
    "sourceReview:src/features/assets/bookings/ui/BookingCalendar.tsx#3bf5b328326c77002bb0da8d9516d4bab643da7b188bb96e69e432ced9db09b3",
    "sourceReview:src/features/assets/bookings/ui/BookingDetail.tsx#e27fa4cec95a06b82a0963df4e822c7c9a17f8cc1913fe27276f2f8a8180cb2d",
    "sourceReview:src/features/assets/bookings/ui/BookingDialog.tsx#60b0de448d652d807fe4e2ab5535211c2072737a6bf1df8ec6797563dd86a7d2",
    "sourceReview:src/features/assets/bookings/ui/BookingPolicyEditors.tsx#9974b17c32c49acd60795121415503ea02c048da0f48ca913d037912a501f3ce",
    "sourceReview:src/features/assets/bookings/ui/BookingPullList.tsx#80bb66c6b6338304d48ab0b1c8a9c241faa3ff2813b3ead44a98b2c3855116d6",
    "sourceReview:src/features/assets/bookings/ui/BookingRecordEditors.tsx#9f94180411d35ca274f58d4c127139cb840bf83eafebf216e56379379e797a26",
    "sourceReview:src/features/assets/bookings/ui/BookingResourceFields.tsx#4ee962cbc822b021cbf15d0f374e76ba4d6c2af9dd0ddf0b813b1980bc74b540",
    "sourceReview:src/features/assets/bookings/ui/BookingSettings.tsx#672ba82108b44ea73046f53c5aca2ffdbc3b27f14d8a8bbd0e02acb5ce7fb3ae",
    "sourceReview:src/features/assets/bookings/ui/BookingTimeFields.tsx#69cc2ddaabbd48b68a9a24960b417236b79b05f4221aa90dd53c6d115ec36398",
    "sourceReview:src/features/assets/bookings/ui/BookingWorkspace.tsx#6449fd86dd7d3004933524ec659ae7f9034279730eea42a03be8ce21f563d9a4",
    "sourceReview:src/features/assets/bookings/ui/bookingView.ts#cf5c4f020bcfc431cdfdbb01a9c201924e977c5be34493b35a167382f4ce1f05",
    "sourceReview:src/features/assets/bookings/ui/messages.ts#9c4831ecc6023bb83b0445315fc88923f1e1a6220ded75db4492c1e4fa8f8e3f",
    "sourceReview:src/features/assets/bookings/workingHours.ts#857ac703d3d031f0fd4e4b1fa58a006637d3e26465088a96028b4c3ce3ff9d0f",
    "writer:src/features/assets/bookings/availability.ts#delete:claim",
  ],
  {
    owner: "site-scoped equipment bookings",
    categories: [
      "equipment and kit identities, source bins, quantities, and reservation windows",
      "booking requester and reviewer identity, site roles, descriptions and approval reasons",
      "site operating schedules, calendar summaries and pull list data",
    ],
    subjectRelation:
      "Bookings link a named requester to equipment reserved for a specific window and record the reviewer and operator.",
    purpose:
      "Reserve facility equipment, review staff requests, prevent competing assignments, and produce authorized handover paperwork.",
    disclosure:
      "A site manager sees booking details within that site. A requester sees their own details and anonymous occupancy. Calendar export and pull list include only the projected fields for the authorized record. The Web views and dialogs mask booking content from replay.",
    retention:
      "Synthetic calendar entries, bookings and request receipts live in Web memory until reload.",
    externalEffects:
      "The explicit fixture simulates booking states, approval and capacity. A user can download an event or print a pull list.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
