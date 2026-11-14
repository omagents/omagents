export function resolvePythonCommand({ platform = process.platform, env = process.env } = {}) {
  if (env.OMAGENTS_TEST_PYTHON) return env.OMAGENTS_TEST_PYTHON
  return platform === "win32" ? "python" : "python3"
}
