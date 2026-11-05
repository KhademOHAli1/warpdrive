import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { requireCurrentAuthority } from "@/features/auth/currentAuthority";
import { companyProfiles } from "@/features/company-profile/schema";
import { cancelOperation } from "./cancel";
import { workCatalog } from "./catalog";
import type { Overview, WorkCommand } from "./contracts";
import { fail, operational } from "./errors";
import { apply } from "./install";
import { writeItem } from "./item-writes";
import { allowed, managesProfile, type WorkActor } from "./policy";
import { preview } from "./preview";
import { type ItemFilter, queryItem, queryItems, queryOptions } from "./queries";
import { installationDto, readProfile, readTypes } from "./read";
/** Internal application service. HTTP binds actor to live credentials inside current-authority. */
import { recoverOperation } from "./recovery";
import { workInstallations, workspaceWorkProfiles } from "./schema";
import { commandTransaction } from "./storage";
import { writeType } from "./type-writes";
import { undo } from "./undo";
export class WorkService {
  constructor(
    private readonly db: Db,
    private readonly actor: WorkActor,
    private readonly signal: AbortSignal,
  ) {}
  overview(locale: "en" | "de" | "fa" = "en") {
    return operational(this.signal, async (): Promise<Overview> => {
      if (!this.actor.isActive) fail("forbidden");
      await this.db.insert(companyProfiles).values({ id: true }).onConflictDoNothing();
      const [company] = await this.db
        .select({ workspaceScope: companyProfiles.workspaceScope })
        .from(companyProfiles)
        .where(eq(companyProfiles.id, true));
      this.signal.throwIfAborted();
      if (!company) fail("unavailable");
      const profile = await readProfile(this.db, this.signal);
      const types =
        allowed(this.actor, "work.view") || allowed(this.actor, "work.manage")
          ? await readTypes(this.db, this.signal)
          : [];
      const installations =
        this.actor.type === "admin"
          ? await this.db
              .select()
              .from(workInstallations)
              .orderBy(desc(workInstallations.createdAt))
              .limit(100)
          : [];
      this.signal.throwIfAborted();
      return {
        ...profile,
        workspaceScope: company.workspaceScope,
        catalog: workCatalog(locale),
        workTypes: types,
        installations: installations.map(installationDto),
        permissions: {
          manageProfile: managesProfile(this.actor),
          apply: this.actor.type === "admin",
          view: allowed(this.actor, "work.view"),
          create: allowed(this.actor, "work.create"),
          change: allowed(this.actor, "work.change"),
          manage: allowed(this.actor, "work.manage"),
        },
      };
    });
  }
  items(filter: ItemFilter) {
    return operational(this.signal, () => queryItems(this.db, this.actor, filter, this.signal));
  }
  item(id: string) {
    return operational(this.signal, () => queryItem(this.db, this.actor, id, this.signal));
  }
  options() {
    return operational(this.signal, () => queryOptions(this.db, this.actor, this.signal));
  }
  operation(requestId: string) {
    return operational(this.signal, () =>
      recoverOperation(this.db, this.actor, requestId, this.signal),
    );
  }
  command(input: WorkCommand) {
    return operational(this.signal, async () => {
      await requireCurrentAuthority(this.db, this.signal);
      this.authorizeCommand(input);
      if (input.action === "preview") return preview(this.db, input, this.signal);
      return commandTransaction(this.db, this.actor, input, this.signal, async (tx) => {
        switch (input.action) {
          case "cancel_operation":
            return cancelOperation(tx, this.actor, input, this.signal);
          case "save_preferences": {
            const profile = await readProfile(tx, this.signal);
            if (profile.revision !== input.expectedRevision) fail("conflict");
            await tx
              .update(workspaceWorkProfiles)
              .set({
                preferences: input.preferences,
                revision: profile.revision + 1,
                updatedAt: new Date(),
              })
              .where(eq(workspaceWorkProfiles.id, true));
            this.signal.throwIfAborted();
            return { revision: profile.revision + 1, preferences: input.preferences };
          }
          case "apply":
            return apply(tx, this.actor, input, this.signal);
          case "undo":
            return undo(tx, this.actor, input, this.signal);
          case "configure_type":
          case "archive_type":
            return writeType(tx, this.actor, input, this.signal);
          case "create_item":
          case "update_item":
          case "archive_item":
            return writeItem(tx, this.actor, input, this.signal);
        }
      });
    });
  }
  private authorizeCommand(input: WorkCommand) {
    if (!this.actor.isActive) fail("forbidden");
    switch (input.action) {
      case "cancel_operation":
        break;
      case "save_preferences":
        if (!managesProfile(this.actor)) fail("forbidden");
        break;
      case "apply":
      case "undo":
      case "preview":
        if (this.actor.type !== "admin") fail("forbidden");
        break;
      case "configure_type":
      case "archive_type":
        if (!allowed(this.actor, "work.manage")) fail("forbidden");
        break;
      case "create_item":
        if (!allowed(this.actor, "work.create")) fail("forbidden");
        break;
      case "update_item":
      case "archive_item":
        if (!allowed(this.actor, "work.change")) fail("forbidden");
        break;
    }
  }
}
