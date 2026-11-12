import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  defaultRunner,
  ensureBaseEnvironment,
  ensureProjectEnvironment,
  getProjectVenvPath,
  getVenvPython,
  inspectPython,
  runProjectPip,
  runProjectPython,
} from "../hooks/python-env.js"
import { main as projectVenvMain } from "../hooks/project-venv.js"

const IS_WIN = process.platform === "win32"
const VENV_BIN = IS_WIN ? "Scripts" : "bin"
const PYTHON_NAME = IS_WIN ? "python.exe" : "python"

function tempDir(t, prefix = "omagents-python-env-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function fakePythonPath(venvPath) {
  return path.join(venvPath, VENV_BIN, PYTHON_NAME)
}

function createFakeInterpreter(venvPath) {
  const pythonPath = fakePythonPath(venvPath)
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true })
  fs.writeFileSync(pythonPath, "")
  return pythonPath
}

function infoFor(prefix, version = "3.14.6") {
  const [major, minor] = version.split(".")
  const purelib = path.join(prefix, "lib", `python${major}.${minor}`, "site-packages")
  return {
    version,
    majorMinor: `${major}.${minor}`,
    prefix,
    basePrefix: "/opt/python",
    purelib,
    platlib: purelib,
    sysPath: [purelib],
  }
}

function infoResult(info) {
  return { code: 0, stdout: `${JSON.stringify(info)}\n`, stderr: "" }
}

function success() {
  return { code: 0, stdout: "", stderr: "" }
}

function failure(message = "failed") {
  return { code: 1, stdout: "", stderr: message }
}

function isPythonProbe(args) {
  return args.includes("-c") && args.at(-1).includes("sysconfig")
}

function isImportCheck(args, importName) {
  return args.includes("-c") && args.at(-1) === `import ${importName}`
}

function isModuleCommand(args, moduleName) {
  const index = args.indexOf("-m")
  return index >= 0 && args[index + 1] === moduleName
}

test("inspectPython returns version, prefixes, site paths, and sys.path", async () => {
  const pythonPath = path.join("/tmp", "python with spaces")
  const expected = infoFor("/tmp/base")
  const calls = []
  const runner = async (command, args) => {
    calls.push({ command, args })
    return infoResult(expected)
  }

  const result = await inspectPython(pythonPath, { runner })

  assert.deepEqual(result, expected)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, pythonPath)
  assert.deepEqual(calls[0].args.slice(0, 2), ["-I", "-c"])
  assert.match(calls[0].args.at(-1), /sysconfig/)
})

test("defaultRunner captures output and returns a non-zero exit code", async () => {
  const result = await defaultRunner(process.execPath, [
    "-e",
    'console.log("out"); console.error("err"); process.exit(7)',
  ])

  assert.equal(result.code, 7)
  assert.match(result.stdout, /out/)
  assert.match(result.stderr, /err/)
})

test("getVenvPython uses platform-specific executable paths", () => {
  assert.equal(getVenvPython("/tmp/base", "linux"), "/tmp/base/bin/python")
  assert.equal(
    getVenvPython("C:\\Users\\A B\\base", "win32"),
    "C:\\Users\\A B\\base\\Scripts\\python.exe"
  )
})

test("ensureBaseEnvironment creates a missing base without clearing it", async (t) => {
  const root = tempDir(t)
  const venvPath = path.join(root, "missing-base")
  const systemPython = path.join(root, "system-python")
  const basePython = fakePythonPath(venvPath)
  const sentinel = path.join(venvPath, "keep.txt")
  fs.mkdirSync(venvPath, { recursive: true })
  fs.writeFileSync(sentinel, "keep")
  const calls = []

  const runner = async (command, args) => {
    calls.push({ command, args })
    if (command === systemPython && isModuleCommand(args, "venv")) {
      createFakeInterpreter(venvPath)
      return success()
    }
    if (command === systemPython) return infoResult(infoFor("/opt/python"))
    if (command === basePython) return infoResult(infoFor(venvPath))
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`)
  }

  const result = await ensureBaseEnvironment({
    venvPath,
    pythonCommand: systemPython,
    runner,
    corePackages: [],
    withPip: false,
  })

  const createCall = calls.find((call) => isModuleCommand(call.args, "venv"))
  assert.deepEqual(createCall.args, ["-I", "-m", "venv", "--without-pip", venvPath])
  assert.equal(result.status, "created")
  assert.equal(result.pythonPath, basePython)
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep")
})

test("ensureBaseEnvironment reuses a healthy base without pip", async (t) => {
  const root = tempDir(t)
  const venvPath = path.join(root, "base")
  const basePython = createFakeInterpreter(venvPath)
  const calls = []
  const runner = async (command, args) => {
    calls.push({ command, args })
    if (command === basePython && isPythonProbe(args)) {
      return infoResult(infoFor(venvPath))
    }
    if (command === basePython && isImportCheck(args, "jinja2")) {
      return success()
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`)
  }

  const result = await ensureBaseEnvironment({ venvPath, runner })

  assert.equal(result.status, "reused")
  assert.deepEqual(result.installed, [])
  assert.deepEqual(result.skipped, ["jinja2"])
  assert.equal(
    calls.some((call) => call.args.includes("venv")),
    false
  )
  assert.equal(
    calls.some((call) => call.args.includes("pip")),
    false
  )
})

test("ensureBaseEnvironment installs only missing core packages", async (t) => {
  const root = tempDir(t)
  const venvPath = path.join(root, "base")
  const basePython = createFakeInterpreter(venvPath)
  const calls = []
  const runner = async (command, args) => {
    calls.push({ command, args })
    if (command === basePython && isPythonProbe(args)) {
      return infoResult(infoFor(venvPath))
    }
    if (command === basePython && isImportCheck(args, "jinja2")) {
      return failure("No module named jinja2")
    }
    if (command === basePython && isModuleCommand(args, "pip")) return success()
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`)
  }

  const result = await ensureBaseEnvironment({ venvPath, runner })

  assert.deepEqual(result.installed, ["jinja2"])
  assert.deepEqual(result.skipped, [])
  const pipCall = calls.find((call) => isModuleCommand(call.args, "pip"))
  assert.deepEqual(pipCall, {
    command: basePython,
    args: ["-I", "-m", "pip", "install", "jinja2"],
  })
})

test("ensureBaseEnvironment rejects a broken base without deleting it", async (t) => {
  const root = tempDir(t)
  const venvPath = path.join(root, "base")
  const basePython = createFakeInterpreter(venvPath)
  const sentinel = path.join(venvPath, "keep.txt")
  fs.writeFileSync(sentinel, "keep")
  const runner = async () => failure("bad interpreter")

  await assert.rejects(
    ensureBaseEnvironment({ venvPath, runner, corePackages: [] }),
    /Unable to inspect Python.*bad interpreter/
  )
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep")
  assert.equal(fs.existsSync(basePython), true)
})

test("ensureBaseEnvironment rejects Python older than 3.11", async (t) => {
  const root = tempDir(t)
  const venvPath = path.join(root, "base")
  const basePython = createFakeInterpreter(venvPath)
  const runner = async () => infoResult(infoFor(venvPath, "3.10.18"))

  await assert.rejects(
    ensureBaseEnvironment({ venvPath, runner, corePackages: [] }),
    /Python 3\.11\+ is required/
  )
})

test("commands preserve paths containing spaces and quotes", async (t) => {
  const root = tempDir(t)
  const pythonPath = path.join(root, "python with 'single' and \"double\" quotes")
  const calls = []
  const runner = async (command, args) => {
    calls.push({ command, args })
    return infoResult(infoFor(root))
  }

  await inspectPython(pythonPath, { runner })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, pythonPath)
  assert.equal(typeof calls[0].command, "string")
})

test("getProjectVenvPath resolves only .omagents/venv", () => {
  const root = path.resolve("/tmp", "project with spaces")
  assert.equal(getProjectVenvPath(root), path.join(root, ".omagents", "venv"))
})

function mockProjectEnvironment(t, options = {}) {
  const root = tempDir(t)
  const projectRoot = options.projectRoot || root
  const baseVenvPath = path.join(root, "base")
  const projectVenvPath = getProjectVenvPath(projectRoot)
  const basePython = createFakeInterpreter(baseVenvPath)
  const baseInfo = options.baseInfo || infoFor(baseVenvPath)
  const projectInfo = options.projectInfo || infoFor(projectVenvPath)
  projectInfo.sysPath = [projectInfo.purelib, baseInfo.purelib, baseInfo.platlib]
  const calls = []

  const runner = async (command, args, runnerOptions = {}) => {
    calls.push({ command, args, options: runnerOptions })
    if (command === basePython && isModuleCommand(args, "venv")) {
      createFakeInterpreter(projectVenvPath)
      fs.mkdirSync(projectInfo.purelib, { recursive: true })
      return success()
    }
    if (command === basePython && isPythonProbe(args)) {
      return infoResult(baseInfo)
    }
    if (command === projectVenvPath || command === fakePythonPath(projectVenvPath)) {
      if (isPythonProbe(args)) {
        if (options.projectBroken) return failure("bad project interpreter")
        return infoResult(projectInfo)
      }
      if (isModuleCommand(args, "pip")) {
        return options.pipResult || success()
      }
      if (args[0] !== "-c" && args[0] !== "-m") return options.runResult || success()
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`)
  }

  return {
    root,
    projectRoot,
    baseVenvPath,
    projectVenvPath,
    basePython,
    projectPython: fakePythonPath(projectVenvPath),
    baseInfo,
    projectInfo,
    calls,
    runner,
  }
}

test("project ensure creates from base without system site packages", async (t) => {
  const env = mockProjectEnvironment(t)

  const result = await ensureProjectEnvironment({
    projectRoot: env.projectRoot,
    baseVenvPath: env.baseVenvPath,
    runner: env.runner,
    corePackages: [],
    withPip: false,
  })

  const createCall = env.calls.find((call) => isModuleCommand(call.args, "venv"))
  assert.equal(result.status, "created")
  assert.equal(createCall.command, env.basePython)
  assert.deepEqual(createCall.args, ["-I", "-m", "venv", "--without-pip", env.projectVenvPath])
  assert.equal(createCall.args.includes("--system-site-packages"), false)
})

test("project overlay is switchable and safely serialized", async (t) => {
  const windowsSite = "C:\\Users\\A B\\base\\site-packages"
  const env = mockProjectEnvironment(t)
  env.baseInfo.purelib = windowsSite
  env.baseInfo.platlib = windowsSite
  env.projectInfo.sysPath = [env.projectInfo.purelib, windowsSite]

  await ensureProjectEnvironment({
    projectRoot: env.projectRoot,
    baseVenvPath: env.baseVenvPath,
    runner: env.runner,
    corePackages: [],
    withPip: false,
  })

  const pth = fs.readFileSync(path.join(env.projectInfo.purelib, "omagents-base.pth"), "utf8")
  assert.match(pth, /^import os, site;/)
  assert.match(pth, /site\.addsitedir/)
  assert.match(pth, /os\.environ\.get\("OMAGENTS_PROJECT_ONLY"\) != "1"/)
  const match = pth.match(/site\.addsitedir\((\"(?:[^\"\\]|\\.)*\")\)/)
  assert.ok(match, "overlay contains one JSON-compatible Python string literal")
  assert.equal(JSON.parse(match[1]), windowsSite)
})

test("project ensure is idempotent and writes local ignore/metadata files", async (t) => {
  const env = mockProjectEnvironment(t)
  const options = {
    projectRoot: env.projectRoot,
    baseVenvPath: env.baseVenvPath,
    runner: env.runner,
    corePackages: [],
    withPip: false,
  }
  await ensureProjectEnvironment(options)
  const pthPath = path.join(env.projectInfo.purelib, "omagents-base.pth")
  const oldTime = new Date("2000-01-01T00:00:00Z")
  fs.utimesSync(pthPath, oldTime, oldTime)
  const before = fs.statSync(pthPath).mtimeMs
  const venvCallsBefore = env.calls.filter((call) => call.args.includes("venv")).length

  const result = await ensureProjectEnvironment(options)

  assert.equal(result.status, "reused")
  assert.equal(fs.statSync(pthPath).mtimeMs, before)
  assert.equal(env.calls.filter((call) => call.args.includes("venv")).length, venvCallsBefore)
  assert.equal(fs.readFileSync(path.join(env.projectVenvPath, ".gitignore"), "utf8"), "*\n")
  const metadata = JSON.parse(
    fs.readFileSync(path.join(env.projectVenvPath, ".omagents-python.json"), "utf8")
  )
  assert.equal(metadata.schemaVersion, 1)
  assert.equal(metadata.pythonMajorMinor, env.baseInfo.majorMinor)
  assert.equal(fs.existsSync(path.join(env.projectRoot, ".gitignore")), false)
})

test("project ensure rejects a minor-version mismatch without deletion", async (t) => {
  const root = tempDir(t)
  const projectVenvPath = getProjectVenvPath(root)
  const env = mockProjectEnvironment(t, {
    projectRoot: root,
    projectInfo: infoFor(projectVenvPath, "3.13.9"),
  })
  createFakeInterpreter(projectVenvPath)
  const sentinel = path.join(projectVenvPath, "keep.txt")
  fs.writeFileSync(sentinel, "keep")

  await assert.rejects(
    ensureProjectEnvironment({
      projectRoot: root,
      baseVenvPath: env.baseVenvPath,
      runner: env.runner,
      corePackages: [],
      withPip: false,
    }),
    /Python version mismatch.*3\.14.*3\.13/
  )
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep")
})

test("project ensure rejects a broken project interpreter without deletion", async (t) => {
  const env = mockProjectEnvironment(t, { projectBroken: true })
  createFakeInterpreter(env.projectVenvPath)
  const sentinel = path.join(env.projectVenvPath, "keep.txt")
  fs.writeFileSync(sentinel, "keep")

  await assert.rejects(
    ensureProjectEnvironment({
      projectRoot: env.projectRoot,
      baseVenvPath: env.baseVenvPath,
      runner: env.runner,
      corePackages: [],
      withPip: false,
    }),
    /Unable to inspect Python.*bad project interpreter/
  )
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep")
})

test("project pip hides base and run enables it", async (t) => {
  const env = mockProjectEnvironment(t, {
    pipResult: { code: 17, stdout: "", stderr: "pip failed" },
  })
  const options = {
    projectRoot: env.projectRoot,
    baseVenvPath: env.baseVenvPath,
    runner: env.runner,
    corePackages: [],
    withPip: false,
  }

  const pip = await runProjectPip({
    ...options,
    args: ["install", "demo-package"],
    env: { PATH: "/test/bin", OMAGENTS_PROJECT_ONLY: "0" },
  })
  const run = await runProjectPython({
    ...options,
    args: ["script.py", "--flag"],
    env: { PATH: "/test/bin", OMAGENTS_PROJECT_ONLY: "1" },
  })

  const pipCall = env.calls.find(
    (call) => call.command === env.projectPython && isModuleCommand(call.args, "pip")
  )
  const runCall = env.calls.find(
    (call) => call.command === env.projectPython && call.args[0] === "script.py"
  )
  assert.equal(pip.code, 17)
  assert.equal(run.code, 0)
  assert.deepEqual(pipCall.args, ["-I", "-m", "pip", "install", "demo-package"])
  assert.equal(pipCall.options.env.OMAGENTS_PROJECT_ONLY, "1")
  assert.deepEqual(runCall.args, ["script.py", "--flag"])
  assert.equal("OMAGENTS_PROJECT_ONLY" in runCall.options.env, false)
  assert.equal(runCall.options.stdio, "inherit")
})

test("CLI validates arguments and propagates exit codes", async () => {
  const errors = []
  const missingRoot = await projectVenvMain(["ensure"], {
    stdout: () => {},
    stderr: (line) => errors.push(line),
  })
  const missingArgs = await projectVenvMain(["pip", "--root", "/tmp/project"], {
    stdout: () => {},
    stderr: (line) => errors.push(line),
  })
  const pipExit = await projectVenvMain(
    ["pip", "--root", "/tmp/project", "--", "install", "demo"],
    {
      runProjectPip: async () => ({ code: 23 }),
      stdout: () => {},
      stderr: (line) => errors.push(line),
    }
  )

  assert.equal(missingRoot, 1)
  assert.equal(missingArgs, 1)
  assert.equal(pipExit, 23)
  assert.equal(errors.length, 2)
  assert.match(errors[0], /--root/)
  assert.match(errors[1], /requires arguments after --/)
})

test("CLI python reserves stdout for the interpreter path", async () => {
  const stdout = []
  const stderr = []
  const exitCode = await projectVenvMain(["python", "--root", "/tmp/project"], {
    ensureProjectEnvironment: async (options) => {
      options.logger("reused base")
      return { status: "reused", pythonPath: "/tmp/project/.omagents/venv/bin/python" }
    },
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(stdout, ["/tmp/project/.omagents/venv/bin/python"])
  assert.deepEqual(stderr, ["reused base"])
})

test("real Python overlay reuses base, isolates pip, and prefers project packages", async (t) => {
  const root = tempDir(t, "omagents-real-python-")
  const projectRoot = path.join(root, "project")
  const baseVenvPath = path.join(root, "base")
  fs.mkdirSync(projectRoot)
  const pythonCommand = IS_WIN ? "python" : "python3"
  const base = await ensureBaseEnvironment({
    venvPath: baseVenvPath,
    pythonCommand,
    corePackages: [],
    withPip: false,
  })
  fs.mkdirSync(base.info.purelib, { recursive: true })
  fs.writeFileSync(path.join(base.info.purelib, "omagents_probe.py"), 'VALUE = "base"\n')
  const project = await ensureProjectEnvironment({
    projectRoot,
    baseVenvPath,
    pythonCommand,
    corePackages: [],
    withPip: false,
  })

  const normal = await defaultRunner(project.pythonPath, [
    "-c",
    "import omagents_probe; print(omagents_probe.VALUE)",
  ])
  assert.equal(normal.code, 0, normal.stderr)
  assert.equal(normal.stdout.trim(), "base")
  assert.match(
    fs.readFileSync(path.join(project.venvPath, "pyvenv.cfg"), "utf8"),
    /include-system-site-packages = false/
  )

  const projectOnly = await defaultRunner(
    project.pythonPath,
    [
      "-c",
      "import importlib.util, json, sys; print(json.dumps({'found': importlib.util.find_spec('omagents_probe') is not None, 'sysPath': sys.path}))",
    ],
    { env: { ...process.env, OMAGENTS_PROJECT_ONLY: "1" } }
  )
  assert.equal(projectOnly.code, 0, projectOnly.stderr)
  const isolated = JSON.parse(projectOnly.stdout)
  assert.equal(isolated.found, false)
  assert.equal(isolated.sysPath.includes(base.info.purelib), false)

  fs.mkdirSync(project.info.purelib, { recursive: true })
  fs.writeFileSync(path.join(project.info.purelib, "omagents_probe.py"), 'VALUE = "project"\n')
  const shadowed = await defaultRunner(project.pythonPath, [
    "-c",
    "import omagents_probe; print(omagents_probe.VALUE)",
  ])
  assert.equal(shadowed.code, 0, shadowed.stderr)
  assert.equal(shadowed.stdout.trim(), "project")

  const previousProjectOnly = process.env.OMAGENTS_PROJECT_ONLY
  process.env.OMAGENTS_PROJECT_ONLY = "1"
  try {
    const inherited = await runProjectPython({
      projectRoot,
      baseVenvPath,
      pythonCommand,
      corePackages: [],
      withPip: false,
      args: ["-c", `import sys; assert ${JSON.stringify(base.info.purelib)} in sys.path`],
      env: process.env,
    })
    assert.equal(inherited.code, 0)
  } finally {
    if (previousProjectOnly === undefined) delete process.env.OMAGENTS_PROJECT_ONLY
    else process.env.OMAGENTS_PROJECT_ONLY = previousProjectOnly
  }
})

test("internal provisioning ignores shadow modules in the caller working directory", async (t) => {
  const root = tempDir(t, "omagents-shadow-python-")
  const projectRoot = path.join(root, "project")
  const baseVenvPath = path.join(root, "base")
  fs.mkdirSync(projectRoot)
  for (const name of ["json.py", "sysconfig.py", "venv.py", "pip.py"]) {
    fs.writeFileSync(
      path.join(root, name),
      `raise RuntimeError(${JSON.stringify(`${name} was executed`)})\n`
    )
  }

  const previousCwd = process.cwd()
  try {
    process.chdir(root)
    await ensureBaseEnvironment({
      venvPath: baseVenvPath,
      pythonCommand: IS_WIN ? "python" : "python3",
      corePackages: [],
    })
    await ensureProjectEnvironment({
      projectRoot,
      baseVenvPath,
      pythonCommand: IS_WIN ? "python" : "python3",
      corePackages: [],
    })
    const pip = await runProjectPip({
      projectRoot,
      baseVenvPath,
      pythonCommand: IS_WIN ? "python" : "python3",
      corePackages: [],
      args: ["--version"],
    })
    assert.equal(pip.code, 0)
  } finally {
    process.chdir(previousCwd)
  }
})
