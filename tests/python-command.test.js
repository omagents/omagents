import assert from "node:assert/strict"
import { test } from "node:test"

import { resolvePythonCommand } from "../scripts/python-command.js"

test("browser recovery honors an explicit interpreter on every platform", () => {
  for (const platform of ["win32", "linux", "darwin"]) {
    assert.equal(
      resolvePythonCommand({
        platform,
        env: { OMAGENTS_TEST_PYTHON: "C:\\isolated\\python.exe" },
      }),
      "C:\\isolated\\python.exe"
    )
  }
})

test("browser recovery uses python on Windows and python3 on Unix", () => {
  assert.equal(resolvePythonCommand({ platform: "win32", env: {} }), "python")
  for (const platform of ["linux", "darwin"]) {
    assert.equal(resolvePythonCommand({ platform, env: {} }), "python3")
  }
})
