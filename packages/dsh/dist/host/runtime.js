import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { JobBoard, JsonJobStore } from "@omagents/core";
import { createHealthRecords } from "./health.js";
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
    const store = new JsonJobStore({
        filePath: join(profileDirectory, "omagents", "job-board.json"),
    });
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
