const capabilityUpdaters = new WeakMap();
function healthRecord(diagnostics) {
    return {
        status: diagnostics.length === 0 ? "ready" : "degraded",
        diagnostics,
    };
}
export function setDshCapabilityDiagnostics(health, capability, diagnostics) {
    const update = capabilityUpdaters.get(health);
    if (!update)
        throw new TypeError("OmAgents health records must come from createHealthRecords()");
    update(capability, diagnostics);
}
export function appendDshCapabilityDiagnostic(health, capability, diagnostic) {
    setDshCapabilityDiagnostics(health, capability, [
        ...health[capability].diagnostics,
        diagnostic,
    ]);
}
export function createHealthRecords(readPersistenceDiagnostics) {
    const host = { status: "ready", diagnostics: [] };
    const diagnostics = {
        skills: [],
        mcp: [],
        python: [],
        tracking: [],
        tools: [],
        commands: [],
        context: [],
    };
    const health = {
        host,
        get persistence() {
            return healthRecord(readPersistenceDiagnostics());
        },
        get skills() {
            return healthRecord(diagnostics.skills);
        },
        get mcp() {
            return healthRecord(diagnostics.mcp);
        },
        get python() {
            return healthRecord(diagnostics.python);
        },
        get tracking() {
            return healthRecord(diagnostics.tracking);
        },
        get tools() {
            return healthRecord(diagnostics.tools);
        },
        get commands() {
            return healthRecord(diagnostics.commands);
        },
        get context() {
            return healthRecord(diagnostics.context);
        },
    };
    capabilityUpdaters.set(health, (capability, nextDiagnostics) => {
        diagnostics[capability] = Object.freeze([...nextDiagnostics]);
    });
    return health;
}
