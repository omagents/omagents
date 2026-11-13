import { ensureCleanRoom } from "./packed-harness.js"

const summary = await ensureCleanRoom()
console.log(
  JSON.stringify({
    event: "browser-clean-room-ready",
    reused: summary.reused === true,
    cleanRoot: summary.cleanRoot,
    packSha256: summary.packSha256,
  })
)
