import { pathToFileURL } from "node:url"

export function importModule(filePath) {
  return import(pathToFileURL(filePath).href)
}
