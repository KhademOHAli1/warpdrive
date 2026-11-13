import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";

const output = fileURLToPath(new URL("../out/", import.meta.url));
const docs = fileURLToPath(new URL("../docs/", import.meta.url));
const contract = await json(new URL("./public-url-contract.json", import.meta.url));
const origin = "https://docs.warpdrivecrm.com";
const problems = [];

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function files(dir) {
  const nested = await Promise.all(
    (await readdir(dir, { withFileTypes: true })).map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    }),
  );
  return nested.flat();
}

function routePath(path) {
  return path === "/" ? path : path.replace(/\/+$/, "") + "/";
}

function docRoute(file) {
  const slug = relative(docs, file).replace(/\.mdx?$/, "");
  return slug === "intro" ? "/" : routePath("/" + slug);
}

function sidebarRoutes(dir) {
  return contract.navigation[dir].flatMap((entry) => {
    const name = [dir, entry].filter(Boolean).join("/");
    if (Object.hasOwn(contract.navigation, name)) return sidebarRoutes(name);
    return [name === "intro" ? "/" : routePath("/" + name)];
  });
}

function inspectHtml(html) {
  const ids = new Set();
  const targets = [];
  const sidebar = [];
  let title = "";
  let canonical;
  function visit(node, inSidebar = false) {
    const attrs = new Map(node.attrs?.map(({ name, value }) => [name, value]));
    const isSidebar = inSidebar || attrs.get("id") === "nd-sidebar";
    if (attrs.has("id")) ids.add(attrs.get("id"));
    if (node.tagName === "a" && attrs.has("href")) {
      const href = attrs.get("href");
      targets.push(href);
      if (isSidebar) sidebar.push(href);
    }
    if (["img", "script", "source"].includes(node.tagName) && attrs.has("src")) {
      targets.push(attrs.get("src"));
    }
    if (node.tagName === "link" && attrs.has("href")) {
      targets.push(attrs.get("href"));
      if (attrs.get("rel") === "canonical") canonical = attrs.get("href");
    }
    if (node.nodeName === "#text" && node.parentNode?.tagName === "title") {
      title += node.value;
    }
    for (const child of node.childNodes ?? []) visit(child, isSidebar);
  }
  visit(parse(html));
  return { ids, targets, sidebar, title, canonical };
}

const contentFiles = (await files(docs)).filter((file) => /\.mdx?$/.test(file));
const guideRoutes = new Set(contentFiles.map(docRoute));
if (guideRoutes.size !== contentFiles.length) problems.push("Duplicate guide routes");
for (const route of Object.keys(contract.routes)) {
  if (!guideRoutes.has(route)) problems.push("Existing guide removed: " + route);
}

for (const [dir, previous] of Object.entries(contract.navigation)) {
  const { pages } = await json(join(docs, dir, "meta.json"));
  const existing = pages.filter((entry) => previous.includes(entry));
  if (JSON.stringify(existing) !== JSON.stringify(previous)) {
    problems.push("Existing sidebar order changed: " + (dir || "/"));
  }
}

const exported = await files(output);
const assets = new Set(exported.map((file) => "/" + relative(output, file)));
const rendered = new Map();
for (const path of exported.filter((file) => file.endsWith("/index.html"))) {
  const route = routePath("/" + relative(output, path).replace(/index\.html$/, ""));
  rendered.set(route, inspectHtml(await readFile(path, "utf8")));
}

const expected = new Set([...guideRoutes, "/search/"]);
for (const route of expected) {
  const page = rendered.get(route);
  if (!page) {
    problems.push("Missing exported page: " + route);
    continue;
  }
  if (!page.title) problems.push("Missing page title: " + route);
  if (guideRoutes.has(route) && page.canonical !== origin + route) {
    problems.push("Wrong canonical URL: " + route);
  }
  for (const anchor of contract.routes[route] ?? []) {
    if (!page.ids.has(anchor)) problems.push("Missing bookmark: " + route + "#" + anchor);
  }
}
for (const route of rendered.keys()) {
  if (!expected.has(route) && route !== "/404/" && route !== "/_not-found/") {
    problems.push("Unexpected exported page: " + route);
  }
}

const oldSidebar = sidebarRoutes("");
const sidebar = (rendered.get("/")?.sidebar ?? []).filter((href) => oldSidebar.includes(href));
// The header also contributes a Docs link before the first sidebar guide.
if (sidebar[0] === "/" && sidebar[1] === "/") sidebar.shift();
if (JSON.stringify(sidebar) !== JSON.stringify(oldSidebar)) {
  problems.push("Rendered sidebar order differs from the existing guides");
}

let links = 0;
for (const [route, page] of rendered) {
  for (const href of new Set(page.targets)) {
    const url = new URL(href, origin + route);
    if (url.origin !== origin) continue;
    links++;
    const path = decodeURIComponent(url.pathname);
    const target = rendered.get(routePath(path));
    if (target) {
      const fragment = decodeURIComponent(url.hash.slice(1));
      if (fragment && !target.ids.has(fragment)) {
        problems.push(route + " links to missing bookmark: " + href);
      }
    } else if (!assets.has(path)) {
      problems.push(route + " links to missing output: " + href);
    }
  }
}

for (const file of ["/sitemap.xml", "/robots.txt", "/llms.txt", "/api/search.json"]) {
  if (!assets.has(file) || (await stat(join(output, file.slice(1)))).size === 0) {
    problems.push("Missing or empty export: " + file);
  }
}

const canonicalUrls = Array.from(guideRoutes, (route) => origin + route).sort();
if (assets.has("/sitemap.xml")) {
  const sitemap = await readFile(join(output, "sitemap.xml"), "utf8");
  const urls = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
  if (JSON.stringify(urls.sort()) !== JSON.stringify(canonicalUrls)) {
    problems.push("Sitemap URLs differ from the public guide routes");
  }
}

if (assets.has("/llms.txt")) {
  const discovery = await readFile(join(output, "llms.txt"), "utf8");
  const guideLinks = Array.from(discovery.matchAll(/^- \[[^\]]+\]\(([^)]+)\)/gm), (match) => match[1]);
  if (JSON.stringify(guideLinks.sort()) !== JSON.stringify(canonicalUrls)) {
    problems.push("Discovery links differ from the public guide routes");
  }
}

if (problems.length) {
  console.error([...new Set(problems)].join("\n"));
  process.exitCode = 1;
} else {
  const anchors = Object.values(contract.routes).reduce((sum, ids) => sum + ids.length, 0);
  console.log(
    "Checked " + guideRoutes.size + " guides, " + anchors +
      " existing bookmarks, and " + links + " local links and assets.",
  );
}
