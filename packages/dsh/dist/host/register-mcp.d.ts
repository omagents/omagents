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
/** Structural subset of DSH 0.2.2-rc.2+ `@deepseek-ai/dsh-mcp-manager`. */
interface NativeMcpManagerView {
    readonly name: string;
}
interface NativeMcpManager {
    list(): Iterable<NativeMcpManagerView>;
    register(name: string, entry: NativeMcpRegistration): () => void;
}
/** Server entry accepted by the built-in manager; all endpoint fields are optional. */
export interface NativeMcpRegistration {
    transport: "stdio" | "streamable-http";
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
}
/** Translate Core's host-neutral catalog entry into DSH 0.2.2's real client config. */
export declare function toDshMcpConfig(serverName: string, definition: CoreMcpDefinition): McpClient.Config;
/** Translate a validated `McpClient.Config` into the built-in manager's server entry. */
export declare function toDshMcpEntry(config: McpClient.Config): NativeMcpRegistration;
/**
 * Small OmAgents-owned manager over DSH's one-server-per-plugin API.
 * Compositions without the built-in `ctx.mcpManager` manager row (a minimal
 * profile on a supported DSH release) use this adapter; runtimes that compose
 * `@deepseek-ai/dsh-mcp-manager` use the native manager through
 * `adaptNativeMcpManager` below.
 */
export declare function createDshMcpManager(ctx: Context): DshMcpManager;
/**
 * Adapt the native `@deepseek-ai/dsh-mcp-manager` service to this module's
 * registration seam. The manager owns instance lifecycle and readiness, so
 * `ready` resolves immediately and `dispose` removes the contribution.
 */
export declare function adaptNativeMcpManager(manager: NativeMcpManager): DshMcpManager;
/** Register the canonical Core catalog when DSH tools are available, preserving user names. */
export declare function registerDshMcp(ctx: Context, env: NodeJS.ProcessEnv, health: DshHealth): () => Promise<void>;
export {};
