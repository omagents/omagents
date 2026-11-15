import { readFile } from "node:fs/promises"
import { basename } from "node:path"

import { defineConfig } from "tsdown/config"

const packageName = "@omagents/omagents-dsh"

/** Inline plugin-owned CSS through the same lazy-factory path as DSH Clients. */
function jobBoardCss() {
  return {
    name: "omagents-job-board-css",
    load: {
      filter: { id: /\.module\.css$/ },
      async handler(id: string) {
        const css = await readFile(id, "utf8")
        const tagId = `${packageName}/${basename(id)}`
        return {
          code: `
const css = ${JSON.stringify(css)};
const tagId = ${JSON.stringify(tagId)};
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = ${JSON.stringify(packageName)};
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
export default {};
`,
          moduleSideEffects: true,
          moduleType: "js",
        }
      },
    },
  }
}

export default defineConfig({
  entry: { client: "src/client/browser.ts" },
  outDir: "dist",
  platform: "neutral",
  target: "es2023",
  format: "cjs",
  fixedExtension: false,
  outExtensions: () => ({ js: ".js" }),
  clean: false,
  sourcemap: true,
  dts: false,
  css: false,
  deps: {
    neverBundle: true,
    // The protocol package has no browser Client row; DSH's official bundles
    // inline this small RemoteInfo runtime while keeping Zod external.
    alwaysBundle: ["@deepseek-ai/dsh-typert-protocol/remote-info"],
    onlyBundle: ["@deepseek-ai/dsh-typert-protocol"],
  },
  plugins: [jobBoardCss()],
  banner: `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(packageName)},\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;`,
  footer: `    return module.exports;\n  }\n});`,
})
