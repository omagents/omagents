import { after, before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { withCorePackLock } from "../../../tests/core-pack-lock.js"
import { runNpm } from "../../../tests/npm-launcher.js"

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..")
const PACKAGE_NAME = "@omagents/omagents-codex"
const VERSION = "0.16.2"
const OLD_CODEX_COMMAND = "npx @omagents/omagents" + " codex"
const SEARCH_PROXY_MODULES = [
  "backends.mjs",
  "errors.mjs",
  "index.mjs",
  "remote-client.mjs",
  "router.mjs",
  "stdio-server.mjs",
]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  })
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}\nerror: ${result.error || "none"}`
  )
  return result
}

function runNpmCommand(args, options = {}) {
  const result = runNpm(args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  })
  assert.equal(
    result.status,
    0,
    `npm ${args.join(" ")} failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}\nerror: ${result.error || "none"}`
  )
  return result
}

function packWorkspace(name, destination) {
  const result = runNpmCommand(
    ["pack", "--workspace", name, "--pack-destination", destination, "--json"],
    { cwd: ROOT }
  )
  const [artifact] = JSON.parse(result.stdout)
  return {
    artifact,
    tarball: path.join(destination, path.basename(artifact.filename)),
  }
}

function makeTempDir(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

function runCli(fixture, args, { cwd, home, env = {} }) {
  const childEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    GITHUB_TOKEN: "",
    OMAGENTS_SEARCH_PROVIDER: "auto",
    EXA_API_KEY: "",
    KEENABLE_API_KEY: "",
    YDC_API_KEY: "",
    CONTEXT7_API_KEY: "",
    ...env,
  }
  delete childEnv.CODEX_HOME
  return spawnSync(process.execPath, [fixture.cli, ...args], {
    cwd,
    encoding: "utf8",
    env: childEnv,
  })
}

function assertCliSuccess(result) {
  assert.equal(
    result.status,
    0,
    `Codex CLI failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}\nerror: ${result.error || "none"}`
  )
}

function installedPluginRoot(home) {
  return path.join(home, ".codex", "plugins", "cache", "omagents", "omagents", "local")
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  })
}

function assertCompleteProxy(directory, sourceDirectory) {
  assert.equal(fs.existsSync(directory), true, `Proxy asset directory must exist: ${directory}`)
  assert.deepEqual(fs.readdirSync(directory).sort(), [...SEARCH_PROXY_MODULES].sort())
  for (const name of SEARCH_PROXY_MODULES) {
    assert.equal(
      fs.readFileSync(path.join(directory, name), "utf8"),
      fs.readFileSync(path.join(sourceDirectory, name), "utf8"),
      `${name} must be copied verbatim from the packed Core runtime`
    )
  }
}

function runProxyHandshake(entry, nonexistentNpmCache) {
  const requests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "packed-codex-installer-test", version: "1.0.0" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ]
  const result = spawnSync(process.execPath, [entry], {
    input: `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      NODE_PATH: "",
      NODE_OPTIONS: "",
      npm_config_cache: nonexistentNpmCache,
      NPM_CONFIG_CACHE: nonexistentNpmCache,
      OMAGENTS_SEARCH_PROVIDER: "auto",
      EXA_API_KEY: "",
      KEENABLE_API_KEY: "",
      YDC_API_KEY: "",
    },
  })
  assert.equal(
    result.status,
    0,
    `relocated packed Proxy failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}\nerror: ${result.error || "none"}`
  )
  assert.equal(result.stderr, "")
  const responses = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.equal(responses.length, 2)
  assert.equal(responses[0].id, 1)
  assert.equal(responses[0].result.protocolVersion, "2025-06-18")
  assert.equal(responses[1].id, 2)
  assert.deepEqual(
    responses[1].result.tools.map((tool) => tool.name),
    ["search", "fetch"]
  )
}

describe("isolated standalone Codex package", () => {
  let fixture

  before(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-codex-package-"))
    fixture = { root }
    const packDir = path.join(root, "pack")
    const installDir = path.join(root, "install")
    fs.mkdirSync(packDir, { recursive: true })

    const core = withCorePackLock(() => packWorkspace("@omagents/core", packDir))
    const codex = packWorkspace(PACKAGE_NAME, packDir)
    runNpmCommand(
      [
        "install",
        "--prefix",
        installDir,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        core.tarball,
        codex.tarball,
      ],
      { cwd: root }
    )

    fixture = {
      root,
      artifact: codex.artifact,
      corePackageDir: path.join(installDir, "node_modules", "@omagents", "core"),
      packageDir: path.join(installDir, "node_modules", "@omagents", "omagents-codex"),
      cli: path.join(
        installDir,
        "node_modules",
        "@omagents",
        "omagents-codex",
        "bin",
        "install.js"
      ),
    }
  })

  after(() => {
    if (fixture) fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  test("package has the exact identity, Core dependency, bin, and publish contents", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(fixture.packageDir, "package.json"), "utf8"))
    assert.equal(pkg.name, PACKAGE_NAME)
    assert.equal(pkg.version, VERSION)
    assert.deepEqual(pkg.bin, { "omagents-codex": "bin/install.js" })
    assert.equal(pkg.dependencies["@omagents/core"], VERSION)
    assert.equal(pkg.dependencies.superpowers, undefined)

    const packedPaths = new Set(fixture.artifact.files.map((file) => file.path))
    for (const expected of ["package.json", "bin/install.js", "src/setup.js"]) {
      assert.ok(packedPaths.has(expected), `Codex tarball must contain ${expected}`)
    }
    assert.equal(fs.existsSync(path.join(fixture.packageDir, "src", "setup.js")), true)
    assert.equal(fs.existsSync(path.join(fixture.packageDir, ".codex")), false)
    assert.equal(fs.existsSync(path.join(fixture.packageDir, "node_modules", "@omagents")), false)
  })

  test("installs Codex with no arguments from the real isolated package", (t) => {
    const tempProject = makeTempDir(t, "omagents-codex-project-")
    const tempHome = makeTempDir(t, "omagents-codex-home-")
    fs.mkdirSync(path.join(tempHome, ".codex"))

    const result = runCli(fixture, [], { cwd: tempProject, home: tempHome })
    assertCliSuccess(result)

    const pluginRoot = installedPluginRoot(tempHome)
    const hooksDir = path.join(pluginRoot, "hooks")
    assert.equal(fs.existsSync(path.join(hooksDir, "hooks.json")), true)
    for (const name of ["python-env.js", "setup-venv.js", "project-venv.js"]) {
      assert.equal(fs.existsSync(path.join(hooksDir, name)), true, `${name} should be installed`)
    }

    const plugin = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8")
    )
    assert.equal(plugin.name, "omagents")
    assert.equal(plugin.version, VERSION)
    assert.equal(plugin.skills, "./skills/")
    assert.equal(plugin.mcpServers, "./.mcp.json")
    assert.equal(plugin.hooks, "./hooks/hooks.json")
    assert.equal(
      fs.existsSync(
        path.join(tempHome, ".codex", "plugins", "cache", "omagents", "marketplace.json")
      ),
      true
    )

    assert.equal(fs.existsSync(path.join(pluginRoot, "skills", "deep-research", "SKILL.md")), true)
    assert.equal(
      fs.existsSync(path.join(pluginRoot, "skills", "superpowers", "brainstorming", "SKILL.md")),
      true
    )
    assert.equal(
      fs.existsSync(path.join(pluginRoot, "skills", "_shared", "scripts", "loop_engine.py")),
      true
    )
    const researchSkill = fs.readFileSync(
      path.join(pluginRoot, "skills", "deep-research", "SKILL.md"),
      "utf8"
    )
    assert.match(researchSkill, /web_search/)
    assert.doesNotMatch(researchSkill, /websearch_web_search_exa|webfetch/)
    const brainstormingSkill = fs.readFileSync(
      path.join(pluginRoot, "skills", "superpowers", "brainstorming", "SKILL.md"),
      "utf8"
    )
    const writingPlansSkill = fs.readFileSync(
      path.join(pluginRoot, "skills", "superpowers", "writing-plans", "SKILL.md"),
      "utf8"
    )
    assert.match(brainstormingSkill, /docs\/specs\//)
    assert.match(writingPlansSkill, /docs\/plans\//)
    assert.doesNotMatch(brainstormingSkill, /docs\/superpowers\//)
    assert.doesNotMatch(writingPlansSkill, /docs\/superpowers\//)

    const mcp = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"))
    assert.deepEqual(mcp.mcpServers.context7, {
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    })
    assert.deepEqual(mcp.mcpServers.grep_app, { url: "https://mcp.grep.app" })
    assert.equal(mcp.mcpServers.github, undefined)
    assert.deepEqual(mcp.mcpServers.websearch, {
      command: "node",
      args: [path.join(pluginRoot, "mcp-servers", "search-proxy", "index.mjs")],
    })
    assert.equal(mcp.mcpServers.keenable, undefined)

    const configPath = path.join(tempHome, ".codex", "config.toml")
    const config = fs.readFileSync(configPath, "utf8")
    assert.match(config, /\[plugins\."omagents@omagents"\]\nenabled = true/)
    const secondRun = runCli(fixture, [], { cwd: tempProject, home: tempHome })
    assertCliSuccess(secondRun)
    assert.equal(fs.readFileSync(configPath, "utf8").match(/# >>> omagents >>>/g).length, 1)
  })

  test("actual packed CLI auto installs a complete relocatable proxy without TypeScript or a build step", (t) => {
    const tempProject = makeTempDir(t, "omagents codex project 空间 ")
    const tempHome = path.join(
      makeTempDir(t, "omagents codex home 空间 "),
      "home with spaces 日本語"
    )
    fs.mkdirSync(path.join(tempHome, ".codex"), { recursive: true })

    const result = runCli(fixture, [], {
      cwd: tempProject,
      home: tempHome,
      env: {
        OMAGENTS_SEARCH_PROVIDER: "auto",
        EXA_API_KEY: "packed-auto-exa-secret",
        KEENABLE_API_KEY: "packed-auto-keenable-secret",
        YDC_API_KEY: "packed-auto-youcom-secret",
      },
    })
    assertCliSuccess(result)

    const pluginRoot = installedPluginRoot(tempHome)
    const proxyDir = path.join(pluginRoot, "mcp-servers", "search-proxy")
    const copiedEntry = path.join(proxyDir, "index.mjs")
    const sourceProxyDir = path.join(fixture.corePackageDir, "mcp-servers", "search-proxy")
    const mcp = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"))
    assert.deepEqual(mcp.mcpServers.websearch, {
      command: "node",
      args: [copiedEntry],
      env: {
        EXA_API_KEY: "packed-auto-exa-secret",
        KEENABLE_API_KEY: "packed-auto-keenable-secret",
        YDC_API_KEY: "packed-auto-youcom-secret",
      },
    })
    assert.equal(mcp.mcpServers.keenable, undefined)
    assertCompleteProxy(proxyDir, sourceProxyDir)

    const configuredEntry = mcp.mcpServers.websearch.args[0]
    assert.equal(path.isAbsolute(configuredEntry), true)
    assert.equal(configuredEntry.includes(ROOT), false)
    assert.equal(configuredEntry.includes(fixture.corePackageDir), false)
    assert.equal(configuredEntry.includes(fixture.packageDir), false)
    assert.doesNotMatch(configuredEntry, /[\\/](?:_?npx)[\\/]/i)

    const relocatedParent = path.join(
      makeTempDir(t, "omagents packed relocation 空间 "),
      "another copy 日本語"
    )
    const relocatedProxy = path.join(relocatedParent, "search-proxy")
    fs.cpSync(proxyDir, relocatedProxy, { recursive: true })
    assertCompleteProxy(relocatedProxy, sourceProxyDir)

    const renamedPackages = []
    try {
      for (const packageDir of [fixture.corePackageDir, fixture.packageDir]) {
        const unavailableDir = `${packageDir}.unavailable-${process.pid}`
        fs.renameSync(packageDir, unavailableDir)
        renamedPackages.push([packageDir, unavailableDir])
      }
      assert.equal(fs.existsSync(fixture.corePackageDir), false)
      assert.equal(fs.existsSync(fixture.packageDir), false)
      runProxyHandshake(
        path.join(relocatedProxy, "index.mjs"),
        path.join(relocatedParent, "nonexistent npm cache")
      )
    } finally {
      for (const [packageDir, unavailableDir] of renamedPackages.reverse()) {
        if (fs.existsSync(unavailableDir)) fs.renameSync(unavailableDir, packageDir)
      }
    }
    assert.equal(fs.existsSync(fixture.corePackageDir), true)
    assert.equal(fs.existsSync(fixture.packageDir), true)
  })

  test("prints help without installing", (t) => {
    const tempProject = makeTempDir(t, "omagents-codex-project-")
    const tempHome = path.join(makeTempDir(t, "omagents-codex-home-"), "new-home")
    const result = runCli(fixture, ["--help"], { cwd: tempProject, home: tempHome })

    assertCliSuccess(result)
    assert.match(result.stdout, /Usage: npx @omagents\/omagents-codex \[options\]/)
    assert.match(result.stdout, /--help/)
    assert.match(result.stdout, /--version/)
    assert.doesNotMatch(result.stdout, /codex\|opencode/)
    assert.equal(fs.existsSync(path.join(tempHome, ".codex")), false)
  })

  test("prints the package version without installing", (t) => {
    const tempProject = makeTempDir(t, "omagents-codex-project-")
    const tempHome = path.join(makeTempDir(t, "omagents-codex-home-"), "new-home")
    const result = runCli(fixture, ["--version"], { cwd: tempProject, home: tempHome })

    assertCliSuccess(result)
    assert.equal(result.stdout.trim(), VERSION)
    assert.equal(fs.existsSync(path.join(tempHome, ".codex")), false)
  })

  test("rejects positional hosts and unknown or unexpected arguments", async (t) => {
    for (const args of [["codex"], ["opencode"], ["--unknown"], ["--help", "unexpected"]]) {
      const tempProject = makeTempDir(t, "omagents-codex-project-")
      const tempHome = path.join(makeTempDir(t, "omagents-codex-home-"), "new-home")
      const result = runCli(fixture, args, { cwd: tempProject, home: tempHome })

      assert.notEqual(result.status, 0, `${args.join(" ")} should be rejected`)
      assert.match(result.stderr, /Unknown or unexpected arguments/)
      assert.match(result.stderr, /Usage: npx @omagents\/omagents-codex \[options\]/)
      assert.equal(fs.existsSync(path.join(tempHome, ".codex")), false)
    }
  })

  test("bin retains its Node shebang and executable mode after installation", () => {
    const sourceCli = path.join(ROOT, "packages", "codex", "bin", "install.js")
    for (const cli of [sourceCli, fixture.cli]) {
      assert.ok(fs.readFileSync(cli, "utf8").startsWith("#!/usr/bin/env node\n"))
      if (process.platform !== "win32") assert.notEqual(fs.statSync(cli).mode & 0o111, 0)
    }
  })
})

test("old OpenCode-to-Codex dispatcher and implementation are gone", () => {
  for (const oldPath of ["index.js", "setup", ".codex", ".codex/plugins/setup.js"]) {
    assert.equal(fs.existsSync(path.join(ROOT, oldPath)), false, `${oldPath} should be absent`)
  }

  const executableRoots = [path.join(ROOT, "packages"), path.join(ROOT, ".opencode")]
  const executableFiles = executableRoots.flatMap(listFiles).filter((file) => file.endsWith(".js"))
  for (const file of executableFiles) {
    assert.doesNotMatch(
      fs.readFileSync(file, "utf8"),
      new RegExp(OLD_CODEX_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${path.relative(ROOT, file)} must not reference the old dispatcher`
    )
  }
})
