import { createContext } from "@/server/trpc/context";
import { createTrpcHttpHandler } from "@/server/trpc/http";
import { appRouter } from "@/server/trpc/root";

const wrapped = createTrpcHttpHandler({ router: appRouter, createContext });

export { wrapped as GET, wrapped as POST };
