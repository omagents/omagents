import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { JobBoard, JsonJobStore } from "@omagents/core";
import { createHealthRecords } from "./health.js";
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
const PROFILE_JOB_PERSISTENCE = new Map();
function createDegradingJobStore(store) {
    const failures = [];
    let degraded = false;
    const shared = PROFILE_JOB_PERSISTENCE.get(store.filePath) ?? {
        tail: Promise.resolve(),
        latestRevision: 0,
    };
    PROFILE_JOB_PERSISTENCE.set(store.filePath, shared);
    const record = (code, operation, error) => {
        const message = `DSH Job Board persistence ${operation} failed; continuing in memory: ${errorMessage(error)}`;
        if (failures.some((diagnostic) => diagnostic.code === code && diagnostic.message === message)) {
            return;
        }
        failures.push({ code, message });
    };
    const settleSaves = async () => {
        // A flush/close must include saves admitted at its boundary, including
        // adapter-queued saves that have not entered Core's own write queue yet.
        while (true) {
            const pending = shared.tail;
            await pending;
            if (pending === shared.tail)
                return;
        }
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
            const loading = shared.tail.then(async () => {
                try {
                    const snapshot = await store.load();
                    shared.latestRevision = snapshot.revision;
                    return snapshot;
                }
                catch (error) {
                    degraded = true;
                    record("ERR_DSH_JOB_STORE_LOAD", "read", error);
                    return { version: 1, revision: 0, jobs: [] };
                }
            });
            shared.tail = loading.then(() => { });
            return loading;
        },
        save(snapshot) {
            if (degraded)
                return shared.tail;
            const admitted = shared.tail.then(async () => {
                // Earlier failure settles every adapter-queued save before this check.
                // Once degraded, no later admission reaches Core's disk-write queue.
                if (degraded)
                    return;
                const revision = typeof snapshot === "object" &&
                    snapshot !== null &&
                    "revision" in snapshot &&
                    typeof snapshot.revision === "number"
                    ? snapshot.revision
                    : 0;
                // A disposed or older overlapping runtime must not replace a newer Board.
                if (revision < shared.latestRevision)
                    return;
                try {
                    await store.save(snapshot);
                    shared.latestRevision = revision;
                }
                catch (error) {
                    degraded = true;
                    record("ERR_DSH_JOB_STORE_SAVE", "write", error);
                }
            });
            shared.tail = admitted;
            return admitted;
        },
        async flush() {
            await settleSaves();
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
            await settleSaves();
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
