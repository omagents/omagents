import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

const IS_WIN = process.platform === "win32"
const VENV_BIN = IS_WIN ? "Scripts" : "bin"
const PYTHON_CMD = IS_WIN ? "python" : "python3"

export const AGENT_VENV = path.join(os.homedir(), ".venvs", "omagents")
export const AGENT_VENV_BIN = path.join(AGENT_VENV, VENV_BIN)
export const CORE_PYTHON_PACKAGES = Object.freeze([
  Object.freeze({ requirement: "jinja2", importName: "jinja2" }),
])

const PYTHON_PROBE = [
  "import json, sys, sysconfig",
  "print(json.dumps({",
  '  "version": ".".join(str(part) for part in sys.version_info[:3]),',
  '  "majorMinor": ".".join(str(part) for part in sys.version_info[:2]),',
  '  "prefix": sys.prefix,',
  '  "basePrefix": sys.base_prefix,',
  '  "purelib": sysconfig.get_path("purelib"),',
  '  "platlib": sysconfig.get_path("platlib"),',
  '  "sysPath": sys.path,',
  "}))",
].join("\n")

export function getVenvPython(venvPath, platform = process.platform) {
  if (platform === "win32") {
    return path.win32.join(venvPath, "Scripts", "python.exe")
  }
  return path.join(venvPath, "bin", "python")
}

export function getProjectVenvPath(projectRoot) {
  return path.join(path.resolve(projectRoot), ".omagents", "venv")
}

export function defaultRunner(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const inherit = options.stdio === "inherit"
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""

    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function failureDetail(result) {
  return result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`
}

function assertSupportedPython(info, pythonPath) {
  const [major, minor] = info.majorMinor.split(".").map(Number)
  if (major < 3 || (major === 3 && minor < 11)) {
    throw new Error(`Python 3.11+ is required; ${pythonPath} reports ${info.version}`)
  }
}

export async function inspectPython(
  pythonPath,
  { runner = defaultRunner, env = process.env, cwd = process.cwd() } = {}
) {
  const result = await runner(pythonPath, ["-I", "-c", PYTHON_PROBE], { env, cwd })
  if (result.code !== 0) {
    throw new Error(`Unable to inspect Python at ${pythonPath}: ${failureDetail(result)}`)
  }
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`Unable to parse Python inspection from ${pythonPath}: ${error.message}`)
  }
}

export async function ensureBaseEnvironment({
  venvPath = AGENT_VENV,
  pythonCommand = PYTHON_CMD,
  runner = defaultRunner,
  corePackages = CORE_PYTHON_PACKAGES,
  withPip = true,
  logger = () => {},
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const pythonPath = getVenvPython(venvPath)
  let status = "reused"

  if (!fs.existsSync(pythonPath)) {
    const systemInfo = await inspectPython(pythonCommand, { runner, env, cwd })
    assertSupportedPython(systemInfo, pythonCommand)
    const args = ["-I", "-m", "venv", ...(withPip ? [] : ["--without-pip"]), venvPath]
    const created = await runner(pythonCommand, args, { env, cwd })
    if (created.code !== 0) {
      throw new Error(`Unable to create Python venv at ${venvPath}: ${failureDetail(created)}`)
    }
    status = "created"
    logger(`Created Python venv at ${venvPath}`)
  }

  const info = await inspectPython(pythonPath, { runner, env, cwd })
  assertSupportedPython(info, pythonPath)
  const installed = []
  const skipped = []

  for (const pkg of corePackages) {
    const imported = await runner(pythonPath, ["-I", "-c", `import ${pkg.importName}`], {
      env,
      cwd,
    })
    if (imported.code === 0) {
      skipped.push(pkg.requirement)
      continue
    }

    logger(`Installing ${pkg.requirement} into ${venvPath}`)
    const result = await runner(pythonPath, ["-I", "-m", "pip", "install", pkg.requirement], {
      env,
      cwd,
    })
    if (result.code !== 0) {
      throw new Error(`Unable to install ${pkg.requirement}: ${failureDetail(result)}`)
    }
    installed.push(pkg.requirement)
  }

  if (status === "reused") logger(`Reused Python venv at ${venvPath}`)
  return { status, venvPath, pythonPath, installed, skipped, info }
}

function writeFileIfChanged(filePath, content) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) return false
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, "utf8")
  return true
}

function baseSitePackages(info) {
  return [...new Set([info.purelib, info.platlib].filter(Boolean))]
}

function overlayContent(sitePackages) {
  return (
    sitePackages
      .map(
        (sitePackage) =>
          `import os, site; os.environ.get("OMAGENTS_PROJECT_ONLY") != "1" and site.addsitedir(${JSON.stringify(sitePackage)})`
      )
      .join("\n") + "\n"
  )
}

export async function ensureProjectEnvironment({
  projectRoot,
  baseVenvPath = AGENT_VENV,
  pythonCommand = PYTHON_CMD,
  runner = defaultRunner,
  corePackages = CORE_PYTHON_PACKAGES,
  withPip = true,
  logger = () => {},
  env = process.env,
  cwd = process.cwd(),
}) {
  const internalEnv = { ...env }
  delete internalEnv.OMAGENTS_PROJECT_ONLY
  const resolvedRoot = path.resolve(projectRoot)
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    throw new Error(`Project root is not an existing directory: ${resolvedRoot}`)
  }

  const base = await ensureBaseEnvironment({
    venvPath: baseVenvPath,
    pythonCommand,
    runner,
    corePackages,
    withPip,
    logger,
    env: internalEnv,
    cwd,
  })
  const venvPath = getProjectVenvPath(resolvedRoot)
  const pythonPath = getVenvPython(venvPath)
  let status = "reused"

  if (!fs.existsSync(pythonPath)) {
    const args = ["-I", "-m", "venv", ...(withPip ? [] : ["--without-pip"]), venvPath]
    const created = await runner(base.pythonPath, args, { env: internalEnv, cwd })
    if (created.code !== 0) {
      throw new Error(`Unable to create project venv at ${venvPath}: ${failureDetail(created)}`)
    }
    status = "created"
    logger(`Created project venv at ${venvPath}`)
  }

  const inspected = await inspectPython(pythonPath, { runner, env: internalEnv, cwd })
  if (inspected.majorMinor !== base.info.majorMinor) {
    throw new Error(
      `Python version mismatch: base uses ${base.info.majorMinor}, project uses ${inspected.majorMinor}; ` +
        `repair ${venvPath} explicitly before retrying`
    )
  }

  const sitePackages = baseSitePackages(base.info)
  writeFileIfChanged(
    path.join(inspected.purelib, "omagents-base.pth"),
    overlayContent(sitePackages)
  )
  writeFileIfChanged(path.join(venvPath, ".gitignore"), "*\n")
  const metadata = {
    schemaVersion: 1,
    baseVenv: base.venvPath,
    basePython: base.pythonPath,
    pythonMajorMinor: base.info.majorMinor,
    baseSitePackages: sitePackages,
  }
  writeFileIfChanged(
    path.join(venvPath, ".omagents-python.json"),
    `${JSON.stringify(metadata, null, 2)}\n`
  )

  const info = await inspectPython(pythonPath, { runner, env: internalEnv, cwd })
  for (const sitePackage of sitePackages) {
    if (!info.sysPath.includes(sitePackage)) {
      throw new Error(`Project overlay did not add base site-packages: ${sitePackage}`)
    }
  }

  if (status === "reused") logger(`Reused project venv at ${venvPath}`)
  return { status, projectRoot: resolvedRoot, venvPath, pythonPath, base, info }
}

export async function runProjectPip(options) {
  const {
    args,
    env = process.env,
    cwd = process.cwd(),
    runner = defaultRunner,
    ...projectOptions
  } = options
  const project = await ensureProjectEnvironment({ ...projectOptions, runner, env, cwd })
  const result = await runner(project.pythonPath, ["-I", "-m", "pip", ...args], {
    env: { ...env, OMAGENTS_PROJECT_ONLY: "1" },
    cwd,
    stdio: "inherit",
  })
  return { code: result.code, project }
}

export async function runProjectPython(options) {
  const {
    args,
    env = process.env,
    cwd = process.cwd(),
    runner = defaultRunner,
    ...projectOptions
  } = options
  const project = await ensureProjectEnvironment({ ...projectOptions, runner, env, cwd })
  const childEnv = { ...env }
  delete childEnv.OMAGENTS_PROJECT_ONLY
  const result = await runner(project.pythonPath, args, {
    env: childEnv,
    cwd,
    stdio: "inherit",
  })
  return { code: result.code, project }
}
