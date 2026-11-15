import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
const scopeSchema = z.object({ parentSessionId: z.string().optional() });
const strictScopeSchema = z.strictObject({ parentSessionId: z.string().optional() });
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
});
const healthRecordSchema = z.object({
    status: z.union([z.literal("ready"), z.literal("degraded")]),
    diagnostics: z.array(z.object({ code: z.string(), message: z.string() })),
});
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
});
const frameSchema = z.object({ revision: z.number(), jobs: z.array(jobSchema) });
function codec(typeSymbol, schema, jsonSchema) {
    return { mode: "strict", typeSymbol, create: () => schema, jsonSchema };
}
function parameter(name, typeSymbol, schema, strictSchema, jsonSchema) {
    return {
        name,
        source: "json",
        codec: codec(typeSymbol, schema, jsonSchema),
        strictCodec: codec(typeSymbol, strictSchema, jsonSchema),
    };
}
const scopeJson = {
    type: "object",
    properties: { parentSessionId: { type: "string" } },
    additionalProperties: false,
};
const jobJson = { type: "object", additionalProperties: true };
const healthJson = { type: "object", additionalProperties: false };
const frameJson = { type: "object", additionalProperties: false };
const listJobs = {
    service: "omagentsRemote",
    invocation: { kind: "direct" },
    parameters: [
        parameter("scope", "JobScope", scopeSchema, strictScopeSchema, scopeJson),
    ],
    result: codec("JobDto[]", z.array(jobSchema), { type: "array", items: jobJson }),
};
const cancelJob = {
    service: "omagentsRemote",
    invocation: { kind: "direct" },
    parameters: [
        parameter("jobId", "string", z.string(), z.string(), { type: "string" }),
    ],
    result: codec("JobDto", jobSchema, jobJson),
};
const getHealth = {
    service: "omagentsRemote",
    invocation: { kind: "direct" },
    parameters: [],
    result: codec("HealthDto", healthSchema, healthJson),
};
const watchJobs = {
    service: "omagentsRemote",
    invocation: { kind: "direct" },
    mode: "stream",
    parameters: [
        parameter("scope", "JobScope", scopeSchema, strictScopeSchema, scopeJson),
    ],
    cancellation: { parameter: "signal" },
    result: codec("JobWatchFrame", frameSchema, frameJson),
};
/** Host-for-Client Remote metadata mounted by the browser Client. */
export const TYPERT_REMOTE = createTypertRemoteInfo({
    package: "@omagents/omagents-dsh",
    methods: {
        "omagents/listJobs": listJobs,
        "omagents/cancelJob": cancelJob,
        "omagents/getHealth": getHealth,
        "omagents/watchJobs": watchJobs,
    },
}, z);
