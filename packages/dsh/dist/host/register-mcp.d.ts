import type { Context } from "@deepseek-ai/cordis";
import * as McpClient from "@deepseek-ai/dsh-mcp-client";
import { type DshHealth } from "./health.js";
interface CoreMcpDefinition {
    type: "local" | "remote";
    command?: string[];
    environment?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    oauth?: boolean;
}
export interface DshMcpRegistration {
    readonly ready: Promise<void>;
    dispose(): Promise<void>;
}
export interface DshMcpManager {
    has(name: string): boolean;
    register(name: string, config: McpClient.Config): DshMcpRegistration;
}
declare module "@deepseek-ai/cordis" {
    interface Context {
        mcpManager?: DshMcpManager;
    }
}
/** Translate Core's host-neutral catalog entry into DSH 0.2.2's real client config. */
export declare function toDshMcpConfig(serverName: string, definition: CoreMcpDefinition): McpClient.Config;
/**
 * Small OmAgents-owned manager over DSH's one-server-per-plugin API.
 * DSH 0.2.2-rc.1 has no built-in ctx.mcpManager service; this adapter keeps
 * registration, user-name precedence, readiness, and disposal in one seam.
 */
export declare function createDshMcpManager(ctx: Context): DshMcpManager;
/** Register the canonical Core catalog without replacing user-configured MCP names. */
export declare function registerDshMcp(ctx: Context, env: NodeJS.ProcessEnv, health: DshHealth): () => Promise<void>;
export {};
