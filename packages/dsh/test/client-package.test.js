import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import vm from "node:vm"

import { Context, Service } from "@deepseek-ai/cordis"
import { validateTypertManifest } from "@deepseek-ai/dsh-typert-loader"
import yaml from "js-yaml"

import { runNpm } from "./npm-launcher.js"

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)

async function manifest() {
  return JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"))
}

async function materializeClient() {
  const code = await readFile(resolve(packageDir, "dist/client.js"), "utf8")
  let registration
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value) {
          registration = value
        },
      },
    },
    // CSS is registered by the build's official lazy factory path. An existing
    // style lets this package-surface test materialize without a browser DOM.
    document: {
      querySelector() {
        return {}
      },
    },
    console,
    AbortController,
    queueMicrotask,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 2,
    clearTimeout: () => {},
  }
  vm.runInNewContext(code, sandbox, { filename: "dist/client.js" })
  assert.ok(registration, "the classic script must register its lazy factory")
  assert.equal(registration.id, "@omagents/omagents-dsh")
  assert.equal(typeof registration.factory, "function")
  return registration.factory(require)
}

test("the bare root Loader row declares the Web Client and built public exports", async () => {
  const pkg = await manifest()
  assert.deepEqual(pkg.dsh.client, {
    platform: "web",
    inject: ["@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-client-ui-renderer"],
  })
  assert.deepEqual(pkg.exports["./client"], {
    types: "./dist/client/index.d.ts",
    default: "./dist/client.js",
  })
  assert.deepEqual(pkg.exports["./typert"], {
    types: "./dist/host/typert.d.ts",
    default: "./dist/host/typert.js",
  })
  const patch = yaml.load(await readFile(resolve(packageDir, "cordis.patch.yml"), "utf8"))
  assert.deepEqual(patch, [{ id: "omagents", name: "@omagents/omagents-dsh" }])
  assert.deepEqual(pkg.files, ["dist/", "cordis.patch.yml"])
  assert.equal(pkg.scripts.prepare, undefined)
})

test("Client source uses only native slots and plugin-owned controls/styles", async () => {
  const sourceDir = resolve(packageDir, "src/client")
  const files = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else files.push(path)
    }
  }
  await visit(sourceDir)
  assert.ok(files.some((path) => path.endsWith("JobBoardPage.tsx")))
  for (const path of files) {
    if (!/\.(?:ts|tsx)$/.test(path)) continue
    const source = await readFile(path, "utf8")
    assert.doesNotMatch(
      source,
      /document\.body|createRoot\s*\(|<iframe|dsh-client-ui-primitives/,
      path
    )
  }

  const css = await readFile(resolve(sourceDir, "job-board.module.css"), "utf8")
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i)
  const colors = css.matchAll(
    /(?:^|[;{])\s*(color|background(?:-color)?|border(?:-[\w-]+)?|outline(?:-color)?|fill|stroke)\s*:\s*([^;}]+)/gim
  )
  let colorCount = 0
  for (const match of colors) {
    // Borders and outlines may include a width/style before their one color.
    if (
      !/(?:color|background|fill|stroke)/i.test(match[1]) &&
      !/\b(?:solid|dashed)\b/.test(match[2])
    ) {
      continue
    }
    colorCount += 1
    assert.match(match[2], /var\(--dsw-alias-[\w-]+\)/, match[0])
  }
  assert.ok(colorCount > 8, "the board must use DSH alias theme tokens throughout")
})

test("built Client is DSH lazy CJS with external React and no source build requirement", async () => {
  const artifact = await readFile(resolve(packageDir, "dist/client.js"), "utf8")
  assert.match(artifact, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(artifact, /id:\s*["']@omagents\/omagents-dsh["']/)
  assert.match(artifact, /factory:\s*\(require\)\s*=>\s*\{/)
  assert.match(artifact, /return module\.exports/)
  assert.match(artifact, /require\(["']react["']\)/)
  assert.match(artifact, /require\(["']react\/jsx-runtime["']\)/)
  const externalRequires = [
    ...new Set([...artifact.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1])),
  ].sort()
  assert.deepEqual(externalRequires, ["react", "react/jsx-runtime", "zod"])
  assert.doesNotMatch(artifact, /document\.body|<iframe/)
  assert.doesNotMatch(artifact, /from\s+["']react["']|export\s+\{\s*apply/)
  await readFile(resolve(packageDir, "dist/client.js.map"), "utf8")
  await readFile(resolve(packageDir, "dist/client/index.d.ts"), "utf8")

  const client = await materializeClient()
  assert.deepEqual(Array.from(client.inject), ["slots", "remote"])
  assert.equal(typeof client.apply, "function")
  assert.equal(Object.hasOwn(client, "default"), false)
  assert.equal(Object.hasOwn(client, "client"), false)
})

test("Client accesses its mounted namespace through derived Cordis injection", async () => {
  const source = await readFile(resolve(packageDir, "src/client/index.ts"), "utf8")
  assert.match(source, /ctx\.inject\(\["remote\.omagents"\]/)
  assert.doesNotMatch(source, /createJobBoardStore\(ctx\.remote\.omagents\)/)
})

test("built Host Typert metadata passes the actual Loader validator", async () => {
  const { TYPERT } = await import(pathToFileURL(resolve(packageDir, "dist/host/typert.js")).href)
  const contribution = validateTypertManifest("@omagents/omagents-dsh", TYPERT)
  assert.equal(contribution.face, "host")
  assert.deepEqual(
    contribution.invocations.map((invocation) => invocation.id),
    [
      "@omagents/omagents-dsh#omagents/listJobs",
      "@omagents/omagents-dsh#omagents/cancelJob",
      "@omagents/omagents-dsh#omagents/getHealth",
      "@omagents/omagents-dsh#omagents/watchJobs",
    ]
  )
  const watch = contribution.invocations.find((invocation) => invocation.method === "watchJobs")
  assert.equal(watch.mode, "stream")
  assert.equal(watch.service, "omagentsRemote")
})

test("root-row disposal unregisters both slots, closes the store, and unmounts Remote", async () => {
  const client = await materializeClient()
  const root = new Context()
  const registrations = []
  const watches = []

  class TestSlots extends Service {
    constructor(ctx) {
      super(ctx, "slots")
    }

    inject(_name, callback) {
      return this.ctx.effect(callback, "test slot declaration")
    }

    register(options, component) {
      const registration = { options, component, active: true }
      registrations.push(registration)
      return () => {
        registration.active = false
      }
    }
  }

  let unmounted = 0
  const remoteJobs = {
    async listJobs() {
      return { ok: true, value: [] }
    },
    async getHealth() {
      return { ok: false, error: { code: "gateway/internal", message: "not started" } }
    },
    async cancelJob(id) {
      return { ok: false, error: { code: "omagents/job-not-found", message: id } }
    },
    watchJobs(_scope, signal) {
      const watch = { signal, returned: 0, pending: undefined }
      watches.push(watch)
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise((resolve) => {
                watch.pending = resolve
              }),
            return: async () => {
              watch.returned += 1
              watch.pending?.({ done: true })
              return { done: true }
            },
          }
        },
      }
    },
  }
  const remote = {
    async $mount(contribution) {
      assert.ok(contribution.methods["omagents/watchJobs"])
      unmounted += 0
      return async () => {
        unmounted += 1
      }
    },
    // The derived remote.omagents injection authorizes this namespace read.
    omagents: remoteJobs,
  }

  new TestSlots(root)
  root.provide("remote", remote)
  root.provide("remote.omagents", remoteJobs)
  await root.plugin(client)
  assert.equal(registrations.length, 2)
  const sidebar = registrations.find((entry) => entry.options.name === "sidebar.panellist")
  const main = registrations.find((entry) => entry.options.name === "main")
  assert.equal(sidebar.options.id, "omagents")
  assert.equal(sidebar.options.label, "OmAgents")
  assert.equal(main.options.key, "omagents")
  assert.equal(typeof main.component, "function")
  assert.ok(registrations.every((entry) => entry.active))
  assert.equal(watches.length, 0, "an unviewed panel must not start network watching")

  const { store } = main.options.inject()
  store.subscribe(() => {})
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(watches.length, 1, "a mounted panel starts one Remote watch after subscribing")

  await root.fiber.dispose()
  assert.ok(registrations.every((entry) => !entry.active))
  assert.equal(unmounted, 1)
  assert.equal(watches[0].signal.aborted, true)
  assert.ok(watches[0].returned > 0, "root disposal closes the active watch")
})

test("packed package contains built Host, Typert, Client, declarations, and no TS/React sources", async () => {
  const { stdout } = await runNpm(["pack", "--dry-run", "--ignore-scripts", "--json"], {
    cwd: packageDir,
    env: { ...process.env, npm_config_ignore_scripts: "true" },
  })
  const [result] = JSON.parse(stdout)
  const paths = result.files.map((file) => file.path)
  for (const required of [
    "dist/client.js",
    "dist/client.js.map",
    "dist/client/index.d.ts",
    "dist/client/remote-store.d.ts",
    "dist/client/components/JobBoardPage.d.ts",
    "dist/host/index.js",
    "dist/host/typert.js",
    "dist/host/typert.d.ts",
  ]) {
    assert.ok(paths.includes(required), `${required} must be published`)
  }
  for (const path of paths) {
    assert.ok(
      path === "package.json" ||
        path === "README.md" ||
        path === "cordis.patch.yml" ||
        path.startsWith("dist/"),
      `unexpected publish path: ${path}`
    )
    assert.doesNotMatch(path, /(^|\/)(?:src|test|tests)(?:\/|$)|tsconfig|tsdown|\.tsx$/)
  }
})
