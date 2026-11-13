import { verifyWebPresentation } from "./web_presentation_policy.mjs";

const profile = {
  version: 1,
  styles: {
    "src/components/shell/TopBar.module.css": ["gap", "height", "padding-inline", "border-radius"],
  },
  copy: Object.fromEntries(
    ["de", "en", "fa"].map((locale) => [
      `src/components/data-table/messages/tableControls.${locale}.json`,
      ["clearSelection"],
    ]),
  ),
  components: {
    "src/components/ui/EmptyState.tsx": ["className"],
  },
};

const [, , root, baselineRevision, currentRevision, ...rest] = process.argv;
if (!root || !baselineRevision || !currentRevision || rest.length !== 0) {
  throw new Error("Expected a Git root, an authorized baseline, and an exact candidate revision");
}
const result = await verifyWebPresentation({ root, baselineRevision, currentRevision, profile });
process.stdout.write(`${JSON.stringify(result)}\n`);
