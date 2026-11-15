import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { JobBoard, JsonJobStore } from "@omagents/core";
import { createHealthRecords } from "./health.js";
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * DSH keeps its current in-memory Board usable after storage failures. Core's
 * stricter sticky-write contract remains unchanged for hosts that need it.
 */
function createDegradingJobStore(store) {
    const failures = [];
    let degraded = false;
    const record = (code, operation, error) => {
        const message = `DSH Job Board persistence ${operation} failed; continuing in memory: ${errorMessage(error)}`;
        if (failures.some((diagnostic) => diagnostic.code === code && diagnostic.message === message)) {
            return;
        }
        failures.push({ code, message });
    };
    return {
        get diagnostics() {
            return [
                // Corrupt-load diagnostics originate in Core. Write failures are
                // represented once by the host-local diagnostics below.
                ...store.diagnostics.filter((diagnostic) => diagnostic.code !== "ERR_JOB_STORE_WRITE"),
                ...failures,
            ];
        },
        async load() {
            try {
                return await store.load();
            }
            catch (error) {
                degraded = true;
                record("ERR_DSH_JOB_STORE_LOAD", "read", error);
                return { version: 1, revision: 0, jobs: [] };
            }
        },
        async save(snapshot) {
            if (degraded)
                return;
            try {
                await store.save(snapshot);
            }
            catch (error) {
                degraded = true;
                record("ERR_DSH_JOB_STORE_SAVE", "write", error);
            }
        },
        async flush() {
            if (degraded)
                return;
            try {
                await store.flush();
            }
            catch (error) {
                degraded = true;
                record("ERR_DSH_JOB_STORE_FLUSH", "flush", error);
            }
        },
        async close() {
            try {
                await store.close();
            }
            catch (error) {
                record("ERR_DSH_JOB_STORE_CLOSE", "close", error);
            }
        },
    };
}
function resolveActiveProfileDirectory(ctx) {
    if (!ctx.baseUrl) {
        throw new Error("OmAgents requires the DSH Loader baseUrl to resolve the active profile");
    }
    const baseUrl = new URL(ctx.baseUrl);
    if (baseUrl.protocol !== "file:") {
        throw new Error(`OmAgents requires a file: DSH Loader baseUrl, received ${ctx.baseUrl}`);
    }
    const basePath = fileURLToPath(baseUrl);
    const configDirectory = resolve(baseUrl.pathname.endsWith("/") ? basePath : dirname(basePath));
    const profilesDirectory = resolve(resolveDshHome(), "profiles");
    const profileName = relative(profilesDirectory, configDirectory);
    if (!profileName ||
        profileName === "." ||
        profileName === ".." ||
        profileName === "node_modules" ||
        profileName.includes(sep) ||
        isAbsolute(profileName)) {
        throw new Error(`OmAgents cannot resolve an active DSH profile from Loader baseUrl ${ctx.baseUrl}`);
    }
    return join(profilesDirectory, profileName);
}
export async function createDshRuntime(ctx) {
    const profileDirectory = resolveActiveProfileDirectory(ctx);
    const store = createDegradingJobStore(new JsonJobStore({
        filePath: join(profileDirectory, "omagents", "job-board.json"),
    }));
    const board = await JobBoard.open({ store });
    const health = createHealthRecords(() => board.diagnostics);
    let disposal;
    return {
        board: board,
        health,
        dispose() {
            disposal ??= (async () => {
                try {
                    await board.flush();
                }
                finally {
                    await board.close();
                }
            })();
            return disposal;
        },
    };
}
