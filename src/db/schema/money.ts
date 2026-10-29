import { customType } from "drizzle-orm/pg-core";
import { canonicalMoney } from "@/lib/canonicalMoney";

export const moneyColumn = customType<{ data: string; driverData: string }>({
  dataType: () => "numeric(18, 4)",
  fromDriver: canonicalMoney,
});
