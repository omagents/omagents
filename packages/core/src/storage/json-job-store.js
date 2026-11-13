import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"

import { emptyJobSnapshot, validateJobSnapshot } from "./schema.js"

function normalizeClock(clock) {
  if (clock === undefined) return Date.now
  if (typeof clock === "function") return clock
  if (typeof clock?.now === "function") return () => clock.now()
  throw new TypeError("clock must be a function or an object with now()")
}

function portableTimestamp(value) {
  const timestamp = String(value).replace(/[<>:"/\\|?*.]/g, "-")
  return timestamp || "unknown"
}

export class JsonJobStore {
  #filePath
  #clock
  #diagnostics = []
  #tail = Promise.resolve()
  #lastWrite = Promise.resolve()
  #closed = false
  #closePromise

  constructor({ filePath, clock } = {}) {
    if (typeof filePath !== "string" || filePath.length === 0) {
      throw new TypeError("filePath must be a non-empty string")
    }
    this.#filePath = resolve(filePath)
    this.#clock = normalizeClock(clock)
  }

  get filePath() {
    return this.#filePath
  }

  get diagnostics() {
    return this.#diagnostics.map((diagnostic) => ({ ...diagnostic }))
  }

  async load() {
    await this.flush()

    let contents
    try {
      contents = await fs.readFile(this.#filePath, "utf8")
    } catch (error) {
      if (error.code === "ENOENT") return emptyJobSnapshot()
      throw error
    }

    try {
      return validateJobSnapshot(JSON.parse(contents))
    } catch (error) {
      const backupPath = await this.#preserveCorruptFile()
      const diagnostic = {
        code: "ERR_JOB_STORE_CORRUPT",
        message: `Corrupt job store preserved at ${backupPath}: ${error.message}`,
        backupPath,
        cause: error,
      }
      this.#diagnostics.push(diagnostic)
      console.warn(`[JsonJobStore] ${diagnostic.message}`)
      return emptyJobSnapshot()
    }
  }

  save(snapshot) {
    if (this.#closed) {
      return Promise.reject(new Error("Cannot save a closed JsonJobStore"))
    }

    let serialized
    try {
      validateJobSnapshot(snapshot)
      serialized = `${JSON.stringify(snapshot, null, 2)}\n`
    } catch (error) {
      return Promise.reject(error)
    }

    const write = this.#tail.then(() => this.#replace(serialized))
    this.#tail = write.catch(() => {})
    this.#lastWrite = write
    return write
  }

  flush() {
    return this.#lastWrite
  }

  close() {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    this.#closePromise = this.flush()
    return this.#closePromise
  }

  async #replace(serialized) {
    const directory = dirname(this.#filePath)
    await fs.mkdir(directory, { recursive: true })
    const temporaryPath = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`

    try {
      await fs.writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx" })
      await fs.rename(temporaryPath, this.#filePath)
    } catch (error) {
      try {
        await fs.unlink(temporaryPath)
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") error.cleanupError = cleanupError
      }
      throw error
    }
  }

  async #preserveCorruptFile() {
    const directory = dirname(this.#filePath)
    const timestamp = portableTimestamp(this.#clock())
    const basePath = `${this.#filePath}.corrupt-${timestamp}`
    let backupPath = basePath

    for (let suffix = 1; ; suffix += 1) {
      try {
        await fs.access(backupPath)
        backupPath = `${basePath}-${suffix}`
      } catch (error) {
        if (error.code !== "ENOENT") throw error
        break
      }
    }

    if (dirname(backupPath) !== directory || basename(backupPath) === basename(this.#filePath)) {
      throw new Error("Invalid corrupt-file backup path")
    }
    await fs.rename(this.#filePath, backupPath)
    return backupPath
  }
}
