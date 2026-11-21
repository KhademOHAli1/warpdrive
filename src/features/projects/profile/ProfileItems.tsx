import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { FormattingPreferences } from "@/lib/localeFormatting";
import { cn } from "@/lib/utils";
import { projectPriorities, projectStatuses } from "../contracts";
import { projectsTranslator } from "../ui/projectMessages";
import type { ProfileItemsInput, ProfileItemsPage, ProfileView } from "./contracts";
import { projectProfileTranslator } from "./messages";
import { profileItemPath, profileItemsPath } from "./paths";

function FilterLinks({
  label,
  links,
}: {
  label: string;
  links: { href: string; active: boolean; label: string }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={link.active ? "page" : undefined}
          className={cn(
            "rounded-md border px-2.5 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
            link.active
              ? "border-transparent bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function ProfileItems({
  view,
  page,
  filter,
  preferences,
}: {
  view: ProfileView;
  page: ProfileItemsPage;
  filter: ProfileItemsInput;
  preferences: FormattingPreferences;
}) {
  const { locale, numberingSystem } = preferences;
  const t = projectProfileTranslator(locale, numberingSystem);
  const project = projectsTranslator(locale, numberingSystem);
  const filtered = filter.status !== undefined || filter.priority !== undefined;
  const first = profileItemsPath(view, { status: filter.status, priority: filter.priority });
  const emptyTitle = view === "assigned" ? t("emptyAssigned") : t("emptyCreated");
  const emptyDescription =
    view === "assigned" ? t("emptyAssignedDescription") : t("emptyCreatedDescription");

  return (
    <div className="space-y-3">
      <FilterLinks
        label={t("filterStatus")}
        links={[undefined, ...projectStatuses].map((status) => ({
          href: profileItemsPath(view, { status, priority: filter.priority }),
          active: status === filter.status,
          label: status ? project(`status.${status}`) : t("allStatuses"),
        }))}
      />
      <FilterLinks
        label={t("filterPriority")}
        links={[undefined, ...projectPriorities].map((priority) => ({
          href: profileItemsPath(view, { status: filter.status, priority }),
          active: priority === filter.priority,
          label: priority ? project(`priority.${priority}`) : t("allPriorities"),
        }))}
      />
      {page.items.length === 0 ? (
        <EmptyState
          className="rounded-lg border bg-card"
          title={filtered ? t("emptyFiltered") : emptyTitle}
          body={emptyDescription}
          action={
            filtered ? (
              <Link
                className="text-sm font-medium text-primary underline"
                href={profileItemsPath(view)}
              >
                {t("clearFilters")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {page.items.map((item) => (
            <li key={item.id}>
              <Link
                href={profileItemPath(item)}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md px-4 py-3 outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <div className="min-w-0 space-y-1">
                  <bdi className="block font-medium [overflow-wrap:anywhere]">{item.title}</bdi>
                  <bdi className="block text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {item.project.title}
                  </bdi>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {item.priority !== "none" && (
                    <Badge variant="outline">{project(`priority.${item.priority}`)}</Badge>
                  )}
                  <Badge variant={item.status === "done" ? "success" : "secondary"}>
                    {project(`status.${item.status}`)}
                  </Badge>
                  <ArrowUpRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {filter.cursor !== undefined || page.nextCursor !== null ? (
        <nav aria-label={t("pagination")} className="flex flex-wrap items-center gap-4 text-sm">
          {filter.cursor === undefined ? null : (
            <Link className="text-primary underline" href={first}>
              {t("firstPage")}
            </Link>
          )}
          {page.nextCursor === null ? null : (
            <Link
              className="text-primary underline"
              href={profileItemsPath(view, { ...filter, cursor: page.nextCursor })}
            >
              {t("nextPage")}
            </Link>
          )}
        </nav>
      ) : null}
    </div>
  );
}
