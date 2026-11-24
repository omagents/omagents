import { test } from "node:test"
import assert from "node:assert/strict"

import { RemoteMcpClient } from "../mcp-servers/search-proxy/remote-client.mjs"
import { createSearchRouter } from "../mcp-servers/search-proxy/router.mjs"

const LIVE_ENABLED = process.env.OMAGENTS_LIVE_SEARCH_TEST === "1"
const LIVE_OPTIONS = {
  skip: LIVE_ENABLED ? false : "set OMAGENTS_LIVE_SEARCH_TEST=1 for public-network smoke tests",
  timeout: 45_000,
}
const LIVE_QUERY = "Model Context Protocol"

function anonymousEnvironment() {
  return { EXA_API_KEY: "", KEENABLE_API_KEY: "", YDC_API_KEY: "" }
}

async function searchOnce(router, label) {
  try {
    return await router.callTool("search", { query: LIVE_QUERY, maxResults: 1 })
  } catch {
    assert.fail(`${label} live request failed`)
  }
}

function assertLiveSuccess(result, provider) {
  assert.ok(result && result.isError !== true, `${provider} live result was an error`)
  const metadata = result?._meta?.omagents
  assert.equal(metadata?.provider, provider, `${provider} provider metadata was missing`)
  assert.ok(
    Array.isArray(result?.content) &&
      result.content.slice(1).some((item) => item?.type === "text" && item.text.trim().length > 0),
    `${provider} live result had no readable backend content`
  )
  return metadata
}

test(
  "anonymous live Exa returns readable content and provider metadata",
  LIVE_OPTIONS,
  async () => {
    const router = createSearchRouter({ env: anonymousEnvironment() })
    try {
      const result = await searchOnce(router, "Exa")
      const metadata = assertLiveSuccess(result, "exa")
      assert.ok(metadata.fallback === null, "Exa live result unexpectedly reported fallback")
    } finally {
      await router.close()
    }
  }
)

test("forced Exa transport failure reaches anonymous live Keenable", LIVE_OPTIONS, async () => {
  const router = createSearchRouter({
    env: anonymousEnvironment(),
    clientFactory(config) {
      if (config.provider !== "exa") return new RemoteMcpClient(config)
      return {
        async ensureReady() {
          const failure = new Error("forced live-test transport failure")
          failure.code = "ECONNRESET"
          throw failure
        },
        async callTool() {
          throw new Error("forced Exa client received an unexpected tool call")
        },
        invalidate() {},
        close() {},
      }
    },
  })
  try {
    const result = await searchOnce(router, "Keenable")
    const metadata = assertLiveSuccess(result, "keenable")
    assert.ok(
      metadata.fallback?.from === "exa",
      "Keenable live result omitted its Exa fallback metadata"
    )
  } finally {
    await router.close()
  }
})

test(
  "forced Exa and Keenable transport failures reach anonymous live You.com",
  LIVE_OPTIONS,
  async () => {
    let youcomCalls = 0
    const router = createSearchRouter({
      env: anonymousEnvironment(),
      clientFactory(config) {
        if (config.provider === "exa" || config.provider === "keenable") {
          return {
            async ensureReady() {
              const failure = new Error(`forced ${config.provider} live-test transport failure`)
              failure.code = "ECONNRESET"
              throw failure
            },
            async callTool() {
              throw new Error(`forced ${config.provider} client received an unexpected tool call`)
            },
            invalidate() {},
            close() {},
          }
        }

        const client = new RemoteMcpClient(config)
        return {
          ensureReady: (options) => client.ensureReady(options),
          async callTool(options) {
            youcomCalls += 1
            return client.callTool(options)
          },
          invalidate: (generation) => client.invalidate(generation),
          close: () => client.close(),
        }
      },
    })
    try {
      const result = await searchOnce(router, "You.com")
      const metadata = assertLiveSuccess(result, "youcom")
      assert.deepEqual(metadata.fallback, { from: "exa", code: "transport" })
      assert.deepEqual(metadata.fallbacks, [
        { from: "exa", code: "transport" },
        { from: "keenable", code: "transport" },
      ])
      assert.equal(youcomCalls, 1, "You.com must receive exactly one live search call")
    } finally {
      await router.close()
    }
  }
)
