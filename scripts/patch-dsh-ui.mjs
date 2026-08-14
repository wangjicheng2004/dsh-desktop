// Applies the desktop-specific conversation UI patch to the pinned DSH bundle.
// Keeping the transformation here makes it reproducible after `npm install` and
// ensures the same client bundle is copied into packaged desktop builds.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(
  root,
  "node_modules",
  "@deepseek-ai",
  "dsh-client-ui-conversation",
  "lib",
  "client.js"
);
const marker = "// dsh-desktop reasoning-duration patch v2";
const legacyMarker = "// dsh-desktop reasoning-duration patch";

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Unable to apply DSH UI patch: ${label} no longer matches the pinned bundle.`);
  }
  return source.replace(before, after);
}

let source = await readFile(target, "utf8");
if (source.includes(marker)) {
  console.log("DSH conversation UI patch already applied.");
  process.exit(0);
}
if (source.includes(legacyMarker)) {
  source = replaceOnce(source, legacyMarker, marker, "legacy patch marker");
  source = replaceOnce(
    source,
    "\t\t\t\t\ttitle: \"Think\",",
    "\t\t\t\t\ttitle: duration,",
    "legacy duration title"
  );
  source = replaceOnce(
    source,
    "\t\t\t\t\tcollapsedContent: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\tclassName: ReasoningRow_module_css_default.separator,\n\t\t\t\t\t\t\"aria-hidden\": true\n\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\tclassName: ReasoningRow_module_css_default.summary,\n\t\t\t\t\t\tchildren: duration\n\t\t\t\t\t})] }),",
    "\t\t\t\t\tcollapsedContent: null,",
    "legacy duration summary"
  );
  await writeFile(target, source);
  console.log(`Upgraded DSH conversation UI patch: ${path.relative(root, target)}`);
  process.exit(0);
}

const originalReasoningRow = `\t\tfunction ReasoningRow({ text, running, t }) {
\t\t\tconst [expanded, setExpanded] = (0, react.useState)(false);
\t\t\tconst summaryRef = (0, react.useRef)(null);
\t\t\tconst summary = running ? latestLine(text) : firstLine(text);
\t\t\tconst scheduleSummaryScroll = useThrottledVisualUpdate(() => {
\t\t\t\tconst element = summaryRef.current;
\t\t\t\tif (element === null) return;
\t\t\t\telement.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0;
\t\t\t});
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tscheduleSummaryScroll();
\t\t\t}, [
\t\t\t\trunning,
\t\t\t\tscheduleSummaryScroll,
\t\t\t\tsummary
\t\t\t]);
\t\t\treturn (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\tclassName: ReasoningRow_module_css_default.root,
\t\t\t\t"data-variant": "think",
\t\t\t\t"data-state": running ? "running" : "ok",
\t\t\t\tchildren: [running && (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\tclassName: accessibility_module_css_default.visuallyHidden,
\t\t\t\t\tchildren: t("row.running")
\t\t\t\t}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
\t\t\t\t\trowClassName: ReasoningRow_module_css_default.row,
\t\t\t\t\tleadingClassName: ReasoningRow_module_css_default.leading,
\t\t\t\t\ttitleClassName: ReasoningRow_module_css_default.title,
\t\t\t\t\tchevronClassName: ReasoningRow_module_css_default.chevron,
\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconThinkOutline14, { size: 14 }),
\t\t\t\t\ttitle: duration,
\t\t\t\t\topen: expanded,
\t\t\t\t\texpandable: true,
\t\t\t\t\texpandOnRowClick: true,
\t\t\t\t\tonToggle: () => {
\t\t\t\t\t\tsetExpanded((value) => !value);
\t\t\t\t\t},
\t\t\t\t\tcollapsedContent: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\tclassName: ReasoningRow_module_css_default.separator,
\t\t\t\t\t\t"aria-hidden": true
\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\tref: summaryRef,
\t\t\t\t\t\tclassName: ReasoningRow_module_css_default.summary,
\t\t\t\t\t\t"data-follow-end": running || void 0,
\t\t\t\t\t\tchildren: summary
\t\t\t\t\t})] }),
\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\tclassName: ReasoningRow_module_css_default.thinkBody,
\t\t\t\t\t\tchildren: text
\t\t\t\t\t})
\t\t\t\t})]
\t\t\t});
\t\t}`;

const patchedReasoningRow = `\t\t${marker}
\t\t/** Re-render once a second while a reasoning step is still in progress. */
\t\tfunction useReasoningClock(startTime, completedTime, running) {
\t\t\tconst [now, setNow] = (0, react.useState)(Date.now());
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (!running || startTime === null) return;
\t\t\t\tsetNow(Date.now());
\t\t\t\tconst timer = setInterval(() => setNow(Date.now()), 1e3);
\t\t\t\treturn () => clearInterval(timer);
\t\t\t}, [running, startTime]);
\t\t\treturn completedTime ?? now;
\t\t}
\t\t/**
\t\t* Keep chain-of-thought private by default and expose it only behind a
\t\t* duration-labelled disclosure. The duration comes from session events,
\t\t* not browser render time, so history and streaming use the same measure.
\t\t*/
\t\tfunction ReasoningRow({ text, running, t, timing }) {
\t\t\tconst [expanded, setExpanded] = (0, react.useState)(false);
\t\t\tconst startTime = timing?.stepStartTime ?? null;
\t\t\tconst currentTime = useReasoningClock(startTime, timing?.completedTime ?? null, running);
\t\t\tconst duration = startTime === null ? t("row.running") : t("message.ranFor", {
\t\t\t\tduration: formatRunDuration(Math.max(0, currentTime - startTime), t)
\t\t\t});
\t\t\treturn (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\tclassName: ReasoningRow_module_css_default.root,
\t\t\t\t"data-variant": "think",
\t\t\t\t"data-state": running ? "running" : "ok",
\t\t\t\tchildren: [running && (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\tclassName: accessibility_module_css_default.visuallyHidden,
\t\t\t\t\tchildren: t("row.running")
\t\t\t\t}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
\t\t\t\t\trowClassName: ReasoningRow_module_css_default.row,
\t\t\t\t\tleadingClassName: ReasoningRow_module_css_default.leading,
\t\t\t\t\ttitleClassName: ReasoningRow_module_css_default.title,
\t\t\t\t\tchevronClassName: ReasoningRow_module_css_default.chevron,
\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconThinkOutline14, { size: 14 }),
\t\t\t\t\ttitle: "Think",
\t\t\t\t\topen: expanded,
\t\t\t\t\texpandable: true,
\t\t\t\t\texpandOnRowClick: true,
\t\t\t\t\tonToggle: () => setExpanded((value) => !value),
\t\t\t\t\tcollapsedContent: null,
\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\tclassName: ReasoningRow_module_css_default.thinkBody,
\t\t\t\t\t\tchildren: text
\t\t\t\t\t})
\t\t\t\t})]
\t\t\t});
\t\t}`;

source = replaceOnce(source, originalReasoningRow, patchedReasoningRow, "ReasoningRow");
source = replaceOnce(
  source,
  "\t\t\t\t\tstatus,\n\t\t\t\t\tturn: state.turn,",
  "\t\t\t\t\tstatus,\n\t\t\t\t\ttiming: {\n\t\t\t\t\t\tstepStartTime: context.start?.event.time ?? null,\n\t\t\t\t\t\tcompletedTime: settled?.time ?? null\n\t\t\t\t\t},\n\t\t\t\t\tturn: state.turn,",
  "assistant timing projection"
);
source = replaceOnce(
  source,
  "function AssistantMarkdown({ blocks, streaming, interrupted, loadImage, mentions, t })",
  "function AssistantMarkdown({ blocks, streaming, interrupted, loadImage, mentions, t, timing })",
  "AssistantMarkdown timing prop"
);
source = replaceOnce(
  source,
  "\t\t\t\t\t\t\ttext: block.text,\n\t\t\t\t\t\t\trunning: streaming && i === last,\n\t\t\t\t\t\t\tt\n\t\t\t\t\t\t}, i));",
  "\t\t\t\t\t\t\ttext: block.text,\n\t\t\t\t\t\t\trunning: streaming && i === last,\n\t\t\t\t\t\t\tt,\n\t\t\t\t\t\t\ttiming\n\t\t\t\t\t\t}, i));",
  "ReasoningRow timing prop"
);
source = replaceOnce(
  source,
  "\t\t\t\tinterrupted: data.status === \"interrupted\",\n\t\t\t\tloadImage,",
  "\t\t\t\tinterrupted: data.status === \"interrupted\",\n\t\t\t\ttiming: data.finalNode?.timing ?? data.timing,\n\t\t\t\tloadImage,",
  "AssistantNodeView timing prop"
);

await writeFile(target, source);
console.log(`Applied DSH conversation UI patch: ${path.relative(root, target)}`);
