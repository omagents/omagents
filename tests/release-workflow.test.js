import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const PACKAGE_DEFINITIONS = [
  { id: "core", name: "@omagents/core" },
  { id: "opencode", name: "@omagents/omagents" },
  { id: "codex", name: "@omagents/omagents-codex" },
  { id: "dsh", name: "@omagents/omagents-dsh" },
]
const HOST_NAMES = PACKAGE_DEFINITIONS.slice(1).map(({ name }) => name)

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

const RELEASE_TAG = `v${readJson(path.join(ROOT, "package.json")).version}`

function makeWorkspace(t, version = "0.14.1") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-release-test-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  writeJson(path.join(root, "package.json"), {
    name: "@omagents/omagents",
    version,
    private: true,
    workspaces: ["packages/*"],
  })
  const lockPackages = {
    "": { name: "@omagents/omagents", version },
  }
  for (const definition of PACKAGE_DEFINITIONS) {
    const manifest = {
      name: definition.name,
      version,
      ...(definition.id === "core" ? {} : { dependencies: { "@omagents/core": version } }),
    }
    writeJson(path.join(root, "packages", definition.id, "package.json"), manifest)
    lockPackages[`packages/${definition.id}`] = structuredClone(manifest)
  }
  writeJson(path.join(root, "package-lock.json"), {
    name: "@omagents/omagents",
    version,
    lockfileVersion: 3,
    requires: true,
    packages: lockPackages,
  })
  return root
}

async function releaseUtils() {
  return import("../scripts/release-utils.js")
}

async function versionSetter() {
  return import("../scripts/set-release-version.js")
}

async function releaseChecker() {
  return import("../scripts/check-release.js")
}

async function releasePublisher() {
  return import("../scripts/publish-all.js")
}

function fakeArtifacts(version = "0.14.1") {
  return {
    version,
    artifacts: PACKAGE_DEFINITIONS.map(({ id, name }) => ({
      id,
      name,
      version,
      tarball: path.join("artifacts", `${id}.tgz`),
    })),
  }
}

test("release plan aligns all versions and publishes Core before sequential hosts", async () => {
  const { readReleasePlan } = await releaseUtils()
  const rootVersion = readJson(path.join(ROOT, "package.json")).version
  const plan = readReleasePlan(ROOT)

  assert.deepEqual(
    plan.packages.map((pkg) => pkg.version),
    Array(4).fill(rootVersion)
  )
  assert.deepEqual(plan.publishOrder, ["core", "opencode", "codex", "dsh"])
  assert.deepEqual(
    plan.packages.map((pkg) => pkg.name),
    ["@omagents/core", "@omagents/omagents", "@omagents/omagents-codex", "@omagents/omagents-dsh"]
  )
  for (const host of plan.hosts) {
    assert.equal(host.dependencies["@omagents/core"], rootVersion)
    for (const otherHost of HOST_NAMES) {
      assert.equal(host.dependencies[otherHost], undefined)
    }
  }
})

test("version setter updates four manifests, the private root, exact Core ranges, and lockfile", async (t) => {
  const root = makeWorkspace(t)
  const { setReleaseVersion } = await versionSetter()

  const plan = setReleaseVersion("1.2.3-rc.1+build.4", { root, gitStatus: () => "" })

  assert.equal(plan.version, "1.2.3-rc.1+build.4")
  assert.equal(readJson(path.join(root, "package.json")).version, plan.version)
  const lock = readJson(path.join(root, "package-lock.json"))
  assert.equal(lock.version, plan.version)
  assert.equal(lock.packages[""].version, plan.version)
  for (const definition of PACKAGE_DEFINITIONS) {
    const manifest = readJson(path.join(root, "packages", definition.id, "package.json"))
    assert.equal(manifest.version, plan.version)
    assert.equal(lock.packages[`packages/${definition.id}`].version, plan.version)
    if (definition.id !== "core") {
      assert.equal(manifest.dependencies["@omagents/core"], plan.version)
      assert.equal(
        lock.packages[`packages/${definition.id}`].dependencies["@omagents/core"],
        plan.version
      )
    }
  }
})

test("version setter rejects invalid exact SemVer without touching fixture files", async (t) => {
  const root = makeWorkspace(t)
  const { setReleaseVersion } = await versionSetter()
  const trackedFiles = [
    "package.json",
    "package-lock.json",
    ...PACKAGE_DEFINITIONS.map(({ id }) => `packages/${id}/package.json`),
  ]
  const before = trackedFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8"))

  for (const version of ["v1.2.3", "1.2", "01.2.3", "1.2.3.4", "^1.2.3", "1.2.3-01", ""]) {
    assert.throws(
      () => setReleaseVersion(version, { root, gitStatus: () => "" }),
      /exact SemVer/i,
      version
    )
  }
  assert.deepEqual(
    trackedFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")),
    before
  )
})

test("version setter refuses a dirty worktree before writing", async (t) => {
  const root = makeWorkspace(t)
  const { setReleaseVersion } = await versionSetter()
  const manifestPath = path.join(root, "packages/core/package.json")
  const before = fs.readFileSync(manifestPath, "utf8")

  assert.throws(
    () => setReleaseVersion("2.0.0", { root, gitStatus: () => " M package.json\n" }),
    /clean working tree/i
  )
  assert.equal(fs.readFileSync(manifestPath, "utf8"), before)
})

test("release checker refuses a dirty publish checkout before running any gate", async () => {
  const { checkRelease } = await releaseChecker()
  const commands = []

  await assert.rejects(
    checkRelease({
      root: ROOT,
      gitStatus: () => "?? release-notes.txt\n",
      runNpm: async (args) => commands.push(args),
    }),
    /clean working tree/i
  )
  assert.deepEqual(commands, [])
})

test("release checker runs build, full tests, inspected packs, clean-room installs, and browser checks", async () => {
  const { checkRelease } = await releaseChecker()
  const events = []

  const result = await checkRelease({
    root: ROOT,
    gitStatus: () => "",
    echo: false,
    runNpm: async (args) => {
      events.push(`npm ${args.join(" ")}`)
      return { stdout: "", stderr: "" }
    },
    inspectArtifacts: async (plan) => {
      events.push(`inspect:${plan.version}`)
      return fakeArtifacts(plan.version)
    },
  })

  assert.deepEqual(events, [
    "npm run build --workspace @omagents/omagents-dsh",
    "npm test",
    "npm run pack:all",
    `inspect:${readJson(path.join(ROOT, "package.json")).version}`,
    "npm run test:packed",
    "npm run test:browser",
  ])
  assert.equal(result.artifacts.artifacts.length, 4)
})

test("publisher without --execute is a side-effect-free plan", async () => {
  const { publishAll } = await releasePublisher()
  let touched = false

  const result = await publishAll({
    root: ROOT,
    execute: false,
    preflight: async () => {
      touched = true
    },
    getPublishedVersion: async () => {
      touched = true
    },
    publishPackage: async () => {
      touched = true
    },
  })

  assert.equal(result.execute, false)
  assert.deepEqual(result.publishOrder, ["core", "opencode", "codex", "dsh"])
  assert.equal(touched, false)
})

test("publisher completes the full clean preflight and artifact inspection before registry access", async () => {
  const { publishAll } = await releasePublisher()
  const events = []

  await assert.rejects(
    publishAll({
      root: ROOT,
      execute: true,
      releaseTag: RELEASE_TAG,
      preflight: async ({ allowDirty }) => {
        events.push(`preflight:allowDirty=${allowDirty}`)
      },
      inspectArtifacts: async () => {
        events.push("artifacts")
        throw new Error("stale artifact")
      },
      getPublishedVersion: async () => {
        events.push("registry")
        return null
      },
    }),
    /stale artifact/
  )
  assert.deepEqual(events, ["preflight:allowDirty=false", "artifacts"])
})

test("publisher confirms the exact Core registry version before publishing hosts", async () => {
  const { publishAll, REGISTRY_CONFIRM_ATTEMPTS, REGISTRY_CONFIRM_INTERVAL_MS } = await releasePublisher()
  const registry = new Map()
  const events = []
  let coreConfirmationAttempts = 0

  const result = await publishAll({
    root: ROOT,
    execute: true,
    releaseTag: RELEASE_TAG,
    echo: false,
    preflight: async () => events.push("preflight"),
    inspectArtifacts: async (plan) => {
      events.push("artifacts")
      return fakeArtifacts(plan.version)
    },
    getPublishedVersion: async (pkg) => {
      events.push(`view:${pkg.id}`)
      if (pkg.id === "core" && registry.has("core")) {
        coreConfirmationAttempts += 1
        if (coreConfirmationAttempts === 1) return null
      }
      return registry.get(pkg.id) ?? null
    },
    publishPackage: async (pkg) => {
      events.push(`publish:${pkg.id}`)
      registry.set(pkg.id, pkg.version)
    },
    delay: async (milliseconds) => events.push(`wait:${milliseconds}`),
  })

  assert.deepEqual(
    events.filter((event) => event.startsWith("publish:")),
    ["publish:core", "publish:opencode", "publish:codex", "publish:dsh"]
  )
  const corePublish = events.indexOf("publish:core")
  const firstHostPublish = events.indexOf("publish:opencode")
  assert.equal(events[corePublish + 1], "view:core")
  assert.equal(events[corePublish + 2], `wait:${REGISTRY_CONFIRM_INTERVAL_MS}`)
  // npm propagation can lag minutes: the default budget must cover at least 4 minutes.
  assert.ok(
    REGISTRY_CONFIRM_INTERVAL_MS * (REGISTRY_CONFIRM_ATTEMPTS - 1) >= 4 * 60 * 1000,
    "registry confirmation must allow at least four minutes of propagation"
  )
  assert.equal(events[corePublish + 3], "view:core")
  assert.ok(corePublish < firstHostPublish)
  assert.ok(events.lastIndexOf("view:core", firstHostPublish) > corePublish)
  assert.deepEqual(
    result.map(({ id, action }) => [id, action]),
    [
      ["core", "published"],
      ["opencode", "published"],
      ["codex", "published"],
      ["dsh", "published"],
    ]
  )
})

test("resume skips registry-verified packages and never republishes them", async () => {
  const { publishAll } = await releasePublisher()
  const version = readJson(path.join(ROOT, "package.json")).version
  const registry = new Map([
    ["core", version],
    ["opencode", version],
  ])
  const publishes = []
  const options = {
    root: ROOT,
    execute: true,
    releaseTag: RELEASE_TAG,
    echo: false,
    preflight: async () => {},
    inspectArtifacts: async (plan) => fakeArtifacts(plan.version),
    getPublishedVersion: async (pkg) => registry.get(pkg.id) ?? null,
    publishPackage: async (pkg) => {
      publishes.push(pkg.id)
      registry.set(pkg.id, pkg.version)
    },
  }

  await publishAll(options)
  assert.deepEqual(publishes, ["codex", "dsh"])

  publishes.length = 0
  const resumed = await publishAll(options)
  assert.deepEqual(publishes, [])
  assert.ok(resumed.every(({ action }) => action === "skipped"))
})

test("registry preflight failure prevents every publish", async () => {
  const { publishAll } = await releasePublisher()
  const publishes = []

  await assert.rejects(
    publishAll({
      root: ROOT,
      execute: true,
      releaseTag: RELEASE_TAG,
      preflight: async () => {},
      inspectArtifacts: async (plan) => fakeArtifacts(plan.version),
      getPublishedVersion: async (pkg) => {
        if (pkg.id === "codex") throw new Error("registry unavailable")
        return null
      },
      publishPackage: async (pkg) => publishes.push(pkg.id),
    }),
    /registry unavailable/
  )
  assert.deepEqual(publishes, [])
})

test("release workflow retains OIDC, requires the clean final gate, and has no placeholder token", async () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/publish.yml"), "utf8")

  assert.match(workflow, /id-token:\s*write/)
  assert.match(workflow, /uses:\s*actions\/setup-python@v6/)
  assert.match(workflow, /python-version:\s*["']3\.12["']/)
  assert.match(workflow, /python -m venv \.omagents\/ci-venv/)
  assert.match(
    workflow,
    /\$\{\{ github\.workspace \}\}\/\.omagents\/ci-venv\/bin\/python -m pip install jinja2/
  )
  assert.match(
    workflow,
    /OMAGENTS_TEST_PYTHON:\s*\$\{\{ github\.workspace \}\}\/\.omagents\/ci-venv\/bin\/python/
  )
  assert.match(workflow, /OMAGENTS_PLAYWRIGHT_WITH_DEPS:\s*["']1["']/)
  assert.match(workflow, /node scripts\/publish-all\.js --execute/)
  assert.doesNotMatch(workflow, /release:check[^\n]*--allow-dirty/)
  assert.doesNotMatch(workflow, /publish-all\.js[^\n]*--allow-dirty/)
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|registry-url/)
})
