import type { LocationDirectory } from "./directory";

const worksId = "088241bf-e5e0-47e9-a8fb-7c7d821d8624";
const serviceId = "ee131634-689c-4a87-a76a-1cf161ed7bc7";
const warehouseId = "8d94b6eb-80b1-4004-8143-97f2a9ff788f";
const receivingId = "3eb14261-429a-456b-bca3-8aaba9d0e74e";

export const locationsFixture: LocationDirectory = {
  sites: [
    { id: worksId, name: "Automation Works", code: "WORKS", archived: false },
    { id: serviceId, name: "Field Service", code: "FIELD", archived: false },
  ],
  locations: [
    {
      id: warehouseId,
      name: "Warehouse",
      code: "WAREHOUSE",
      siteId: worksId,
      parentId: null,
      archived: false,
    },
    {
      id: receivingId,
      name: "Receiving",
      code: "RECEIVING",
      siteId: worksId,
      parentId: warehouseId,
      archived: false,
    },
    {
      id: "34022ee2-32f1-426d-9c4d-ff3d78493610",
      name: "Bin A-01",
      code: "A-01",
      siteId: worksId,
      parentId: receivingId,
      archived: false,
    },
    {
      id: "49db4044-941b-4760-8c7b-e91a49454faf",
      name: "Tool crib",
      code: "TOOL-CRIB",
      siteId: serviceId,
      parentId: null,
      archived: false,
    },
  ],
};
