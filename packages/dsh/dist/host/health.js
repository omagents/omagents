export function createHealthRecords(readPersistenceDiagnostics) {
    const host = { status: "ready", diagnostics: [] };
    return {
        host,
        get persistence() {
            const diagnostics = readPersistenceDiagnostics();
            return {
                status: diagnostics.length === 0 ? "ready" : "degraded",
                diagnostics,
            };
        },
    };
}
