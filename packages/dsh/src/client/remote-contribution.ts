import { z } from "zod"
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info"
import type {
  RemoteResult,
  RemoteStreamHandle,
  TypertRemoteCodecSpec,
  TypertRemoteMethodSpec,
} from "@deepseek-ai/dsh-typert-protocol"

import type { HealthDto, JobDto, JobScope, JobWatchFrame } from "../host/remote-types.js"

const scopeSchema = z.object({ parentSessionId: z.string().optional() })
const strictScopeSchema = z.strictObject({ parentSessionId: z.string().optional() })
const jobSchema = z.looseObject({
  id: z.string(),
  host: z.string(),
  hostTaskId: z.string(),
  parentSessionId: z.string(),
  childName: z.string().optional(),
  alias: z.string(),
  agent: z.string(),
  description: z.string(),
  executionState: z.union([
    z.literal("running"),
    z.literal("cancelling"),
    z.literal("completed"),
    z.literal("failed"),
    z.literal("cancelled"),
    z.literal("interrupted"),
  ]),
  notificationState: z.union([
    z.literal("pending"),
    z.literal("injected"),
    z.literal("acknowledged"),
  ]).optional(),
  launchedAt: z.number(),
  updatedAt: z.number(),
  terminalAt: z.number().optional(),
  cancelRequestedAt: z.number().optional(),
  revision: z.number(),
  resultSummary: z.unknown().optional(),
  error: z.unknown().optional(),
})
const healthRecordSchema = z.object({
  status: z.union([z.literal("ready"), z.literal("degraded")]),
  diagnostics: z.array(z.object({ code: z.string(), message: z.string() })),
})
const healthSchema = z.object({
  host: healthRecordSchema,
  persistence: healthRecordSchema,
  tracking: healthRecordSchema,
  skills: healthRecordSchema,
  mcp: healthRecordSchema,
  python: healthRecordSchema,
  tools: healthRecordSchema,
  commands: healthRecordSchema,
  context: healthRecordSchema,
})
const frameSchema = z.object({ revision: z.number(), jobs: z.array(jobSchema) })

function codec(
  typeSymbol: string,
  schema: z.ZodType,
  jsonSchema: Record<string, unknown>
): TypertRemoteCodecSpec {
  return { mode: "strict", typeSymbol, create: () => schema, jsonSchema }
}

function parameter(
  name: string,
  typeSymbol: string,
  schema: z.ZodType,
  strictSchema: z.ZodType,
  jsonSchema: Record<string, unknown>
) {
  return {
    name,
    source: "json" as const,
    codec: codec(typeSymbol, schema, jsonSchema),
    strictCodec: codec(typeSymbol, strictSchema, jsonSchema),
  }
}

const scopeJson = {
  type: "object",
  properties: { parentSessionId: { type: "string" } },
  additionalProperties: false,
}
const jobJson = { type: "object", additionalProperties: true }
const healthJson = { type: "object", additionalProperties: false }
const frameJson = { type: "object", additionalProperties: false }

const listJobs: TypertRemoteMethodSpec = {
  service: "omagentsRemote",
  invocation: { kind: "direct" },
  parameters: [
    parameter("scope", "JobScope", scopeSchema, strictScopeSchema, scopeJson),
  ],
  result: codec("JobDto[]", z.array(jobSchema), { type: "array", items: jobJson }),
}

const cancelJob: TypertRemoteMethodSpec = {
  service: "omagentsRemote",
  invocation: { kind: "direct" },
  parameters: [
    parameter("jobId", "string", z.string(), z.string(), { type: "string" }),
  ],
  result: codec("JobDto", jobSchema, jobJson),
}

const getHealth: TypertRemoteMethodSpec = {
  service: "omagentsRemote",
  invocation: { kind: "direct" },
  parameters: [],
  result: codec("HealthDto", healthSchema, healthJson),
}

const watchJobs: TypertRemoteMethodSpec = {
  service: "omagentsRemote",
  invocation: { kind: "direct" },
  mode: "stream",
  parameters: [
    parameter("scope", "JobScope", scopeSchema, strictScopeSchema, scopeJson),
  ],
  cancellation: { parameter: "signal" },
  result: codec("JobWatchFrame", frameSchema, frameJson),
}

/** Host-for-Client Remote metadata mounted by the browser Client. */
export const TYPERT_REMOTE = createTypertRemoteInfo({
  package: "@omagents/omagents-dsh",
  methods: {
    "omagents/listJobs": listJobs,
    "omagents/cancelJob": cancelJob,
    "omagents/getHealth": getHealth,
    "omagents/watchJobs": watchJobs,
  },
}, z)

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespace$6f6d6167656e7473 {
    listJobs(scope: JobScope): Promise<RemoteResult<JobDto[]>>
    cancelJob(jobId: string): Promise<RemoteResult<JobDto>>
    getHealth(): Promise<RemoteResult<HealthDto>>
    watchJobs(scope: JobScope, signal?: AbortSignal): RemoteStreamHandle<JobWatchFrame, never>
  }
  interface TypertRemoteMap {
    "omagents/listJobs": (scope: JobScope) => Promise<RemoteResult<JobDto[]>>
    "omagents/cancelJob": (jobId: string) => Promise<RemoteResult<JobDto>>
    "omagents/getHealth": () => Promise<RemoteResult<HealthDto>>
    "omagents/watchJobs": (
      scope: JobScope,
      signal?: AbortSignal
    ) => RemoteStreamHandle<JobWatchFrame, never>
  }
  interface TypertRemoteNamespaceMap {
    omagents: TypertRemoteNamespace$6f6d6167656e7473
  }
}
