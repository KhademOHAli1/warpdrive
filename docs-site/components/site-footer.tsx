import Link from "next/link";
import { REPOSITORY_URL, WEBSITE_URL } from "@/lib/site";

const groups = [
  {
    title: "Documentation",
    links: [
      ["Introduction", "/"],
      ["Installation", "/setup/"],
      ["Architecture", "/architecture/"],
    ],
  },
  {
    title: "Features",
    links: [
      ["Pipeline", "/features/pipeline/"],
      ["Deal workspace", "/features/deal-workspace/"],
      ["Email", "/features/email/"],
    ],
  },
  {
    title: "Administration",
    links: [
      ["Users and teams", "/administration/users-and-teams/"],
      ["Permission sets", "/administration/permission-sets/"],
      ["Visibility groups", "/administration/visibility-groups/"],
    ],
  },
  {
    title: "Community",
    links: [
      ["Contributing", "/contributing/"],
      ["GitHub", REPOSITORY_URL],
      ["Website", WEBSITE_URL],
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t bg-fd-card px-6 py-10 text-sm">
      <nav
        aria-label="Footer"
        className="mx-auto grid max-w-5xl grid-cols-2 gap-x-8 gap-y-8 md:grid-cols-4"
      >
        {groups.map(({ title, links }) => (
          <div key={title}>
            <h2 className="mb-3 font-semibold">{title}</h2>
            <ul className="grid gap-2.5">
              {links.map(([name, href]) => (
                <li key={href}>
                  <Link href={href} className="text-fd-muted-foreground hover:text-fd-primary">
                    {name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <p className="mx-auto mt-8 max-w-5xl text-fd-muted-foreground">
        Copyright © {new Date().getUTCFullYear()} Warpdrive. Licensed under MIT.
      </p>
    </footer>
  );
}
