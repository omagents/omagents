import readline from "node:readline"

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

function responseFor(message) {
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "omagents-local-stdio", version: "1.0.0" },
      },
    }
  }
  if (message.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Local handshake probe",
            inputSchema: { type: "object", properties: { text: { type: "string" } } },
          },
        ],
      },
    }
  }
  if (message.id !== undefined) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Unsupported method: ${message.method}` },
    }
  }
  return undefined
}

input.on("line", (line) => {
  if (!line.trim()) return
  const response = responseFor(JSON.parse(line))
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
})
