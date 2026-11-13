const systemScheduler = {
    setInterval(callback, milliseconds) {
        return globalThis.setInterval(callback, milliseconds);
    },
    clearInterval(handle) {
        globalThis.clearInterval(handle);
    },
    setTimeout(callback, milliseconds) {
        return globalThis.setTimeout(callback, milliseconds);
    },
    clearTimeout(handle) {
        globalThis.clearTimeout(handle);
    },
};
function errorMessage(error) {
    if (typeof error === "object" && error !== null && "message" in error) {
        const message = Reflect.get(error, "message");
        if (typeof message === "string" && message.length > 0)
            return message;
    }
    return String(error);
}
function isPermissionDenied(error) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        Reflect.get(error, "code") === "remote-access/denied");
}
function isTerminalExecutionState(state) {
    return (state === "completed" ||
        state === "failed" ||
        state === "cancelled" ||
        state === "interrupted");
}
class RemoteJobBoardStore {
    remote;
    scope;
    readNow;
    scheduler;
    tickIntervalMs;
    reconnectDelayMs;
    listeners = new Set();
    cancellations = new Map();
    snapshot;
    running = false;
    disposed = false;
    watch;
    generation = 0;
    watchMutation = 0;
    tickHandle;
    reconnectHandle;
    constructor(remote, options) {
        this.remote = remote;
        this.scope = options.scope ?? {};
        this.readNow = options.now ?? Date.now;
        this.scheduler = options.scheduler ?? systemScheduler;
        this.tickIntervalMs = options.tickIntervalMs ?? 1_000;
        this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
        this.snapshot = {
            jobs: [],
            revision: 0,
            status: "loading",
            now: this.readNow(),
            cancellingIds: [],
        };
    }
    getSnapshot() {
        return this.snapshot;
    }
    subscribe(listener) {
        if (this.disposed)
            return () => { };
        this.listeners.add(listener);
        if (!this.running)
            this.start();
        let subscribed = true;
        return () => {
            if (!subscribed)
                return;
            subscribed = false;
            this.listeners.delete(listener);
            if (this.listeners.size === 0)
                this.stop();
        };
    }
    async refresh() {
        if (this.disposed)
            return;
        const watchMutation = this.watchMutation;
        try {
            const [listed, health] = await Promise.all([
                this.remote.listJobs(this.scope),
                this.remote.getHealth(),
            ]);
            if (this.disposed || watchMutation !== this.watchMutation)
                return;
            if (!listed.ok) {
                this.applyReadFailure(listed.error);
                return;
            }
            if (!health.ok && isPermissionDenied(health.error)) {
                this.applyReadFailure(health.error);
                return;
            }
            this.publish({
                ...this.snapshot,
                jobs: listed.value,
                health: health.ok ? health.value : this.snapshot.health,
                status: "ready",
                error: undefined,
                lastUpdatedAt: this.readNow(),
            });
        }
        catch (error) {
            if (!this.disposed && watchMutation === this.watchMutation) {
                this.applyReadFailure(error);
            }
        }
    }
    async reconnect() {
        if (this.disposed)
            return;
        this.clearReconnect();
        if (!this.running) {
            this.start();
            return;
        }
        this.openWatch();
    }
    cancelJob(jobId) {
        const existing = this.cancellations.get(jobId);
        if (existing)
            return existing;
        const cancellation = this.performCancellation(jobId);
        this.cancellations.set(jobId, cancellation);
        return cancellation;
    }
    clearActionError() {
        if (this.snapshot.actionError === undefined)
            return;
        this.publish({ ...this.snapshot, actionError: undefined });
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.stop();
        this.listeners.clear();
    }
    async performCancellation(jobId) {
        const watchMutation = this.watchMutation;
        this.publish({
            ...this.snapshot,
            cancellingIds: [...this.snapshot.cancellingIds, jobId],
            actionError: undefined,
        });
        try {
            const result = await this.remote.cancelJob(jobId);
            if (this.disposed || watchMutation !== this.watchMutation)
                return;
            if (!result.ok) {
                if (isPermissionDenied(result.error))
                    this.applyReadFailure(result.error);
                else
                    this.publish({ ...this.snapshot, actionError: errorMessage(result.error) });
                return;
            }
            const currentJob = this.snapshot.jobs.find((job) => job.id === jobId);
            if (!currentJob || result.value.id !== jobId)
                return;
            if (result.value.revision < currentJob.revision)
                return;
            if (isTerminalExecutionState(currentJob.executionState) &&
                !isTerminalExecutionState(result.value.executionState)) {
                return;
            }
            const jobs = this.snapshot.jobs.map((job) => job.id === result.value.id ? result.value : job);
            this.publish({ ...this.snapshot, jobs, lastUpdatedAt: this.readNow() });
        }
        catch (error) {
            if (!this.disposed && watchMutation === this.watchMutation) {
                if (isPermissionDenied(error))
                    this.applyReadFailure(error);
                else
                    this.publish({ ...this.snapshot, actionError: errorMessage(error) });
            }
        }
        finally {
            this.cancellations.delete(jobId);
            if (!this.disposed) {
                this.publish({
                    ...this.snapshot,
                    cancellingIds: this.snapshot.cancellingIds.filter((id) => id !== jobId),
                });
            }
        }
    }
    start() {
        if (this.disposed || this.running)
            return;
        this.running = true;
        this.tickHandle = this.scheduler.setInterval(() => {
            this.publish({ ...this.snapshot, now: this.readNow() });
        }, this.tickIntervalMs);
        this.openWatch();
    }
    stop() {
        this.running = false;
        this.generation += 1;
        if (this.tickHandle !== undefined) {
            this.scheduler.clearInterval(this.tickHandle);
            this.tickHandle = undefined;
        }
        this.clearReconnect();
        this.closeWatch();
    }
    openWatch() {
        if (!this.running || this.disposed)
            return;
        this.generation += 1;
        const generation = this.generation;
        this.closeWatch();
        const controller = new AbortController();
        const hasSnapshot = this.snapshot.lastUpdatedAt !== undefined;
        this.publish({
            ...this.snapshot,
            status: hasSnapshot ? "stale" : "loading",
            error: undefined,
            now: this.readNow(),
        });
        try {
            const iterable = this.remote.watchJobs(this.scope, controller.signal);
            const watch = {
                controller,
                iterator: iterable[Symbol.asyncIterator](),
            };
            this.watch = watch;
            void this.consumeWatch(watch, generation);
        }
        catch (error) {
            this.handleWatchFailure(error, generation, hasSnapshot);
        }
    }
    async consumeWatch(watch, generation) {
        let baseline = true;
        let hasSnapshot = this.snapshot.lastUpdatedAt !== undefined;
        try {
            while (this.watch === watch && this.generation === generation) {
                const next = await watch.iterator.next();
                if (this.watch !== watch || this.generation !== generation)
                    return;
                if (next.done) {
                    throw new Error("The OmAgents Job Board watch ended unexpectedly");
                }
                if (!baseline && next.value.revision < this.snapshot.revision)
                    continue;
                const isBaseline = baseline;
                this.applyFrame(next.value);
                baseline = false;
                hasSnapshot = true;
                if (isBaseline && this.watch === watch && this.generation === generation) {
                    void this.loadHealth(generation, this.watchMutation);
                }
            }
        }
        catch (error) {
            if (this.watch !== watch || this.generation !== generation || watch.controller.signal.aborted) {
                return;
            }
            this.watch = undefined;
            this.handleWatchFailure(error, generation, hasSnapshot);
        }
    }
    applyFrame(frame) {
        this.watchMutation += 1;
        this.publish({
            ...this.snapshot,
            jobs: frame.jobs,
            revision: frame.revision,
            status: "ready",
            error: undefined,
            lastUpdatedAt: this.readNow(),
            now: this.readNow(),
        });
    }
    async loadHealth(generation, watchMutation) {
        try {
            const result = await this.remote.getHealth();
            if (this.disposed ||
                this.generation !== generation ||
                this.watchMutation !== watchMutation) {
                return;
            }
            if (result.ok) {
                this.publish({ ...this.snapshot, health: result.value });
            }
            else if (isPermissionDenied(result.error)) {
                this.applyReadFailure(result.error);
            }
        }
        catch {
            // Watch data remains authoritative when an independent health read is unavailable.
        }
    }
    handleWatchFailure(error, generation, hasSnapshot) {
        if (this.disposed || this.generation !== generation)
            return;
        if (isPermissionDenied(error)) {
            this.enterPermissionDenied(error);
            return;
        }
        this.publish({
            ...this.snapshot,
            status: hasSnapshot ? "stale" : "error",
            error: errorMessage(error),
        });
        this.scheduleReconnect();
    }
    scheduleReconnect() {
        if (!this.running || this.reconnectHandle !== undefined)
            return;
        const generation = this.generation;
        const handle = this.scheduler.setTimeout(() => {
            if (this.reconnectHandle !== handle)
                return;
            this.reconnectHandle = undefined;
            if (!this.running ||
                this.disposed ||
                this.generation !== generation ||
                this.snapshot.status === "permission-denied") {
                return;
            }
            this.openWatch();
        }, this.reconnectDelayMs);
        this.reconnectHandle = handle;
    }
    enterPermissionDenied(error) {
        this.clearReconnect();
        this.generation += 1;
        this.watchMutation += 1;
        this.closeWatch();
        this.publish({
            ...this.snapshot,
            jobs: [],
            status: "permission-denied",
            error: errorMessage(error),
        });
    }
    applyReadFailure(error) {
        if (isPermissionDenied(error)) {
            this.enterPermissionDenied(error);
            return;
        }
        this.publish({
            ...this.snapshot,
            status: this.snapshot.lastUpdatedAt === undefined ? "error" : this.snapshot.status,
            error: errorMessage(error),
            actionError: errorMessage(error),
        });
    }
    closeWatch() {
        const watch = this.watch;
        this.watch = undefined;
        if (!watch)
            return;
        watch.controller.abort();
        if (watch.iterator.return) {
            void watch.iterator.return().catch(() => {
                // Disposal is best-effort after the transport has already failed.
            });
        }
    }
    clearReconnect() {
        if (this.reconnectHandle === undefined)
            return;
        this.scheduler.clearTimeout(this.reconnectHandle);
        this.reconnectHandle = undefined;
    }
    publish(next) {
        this.snapshot = next;
        for (const listener of this.listeners)
            listener();
    }
}
/**
 * Create the browser's ephemeral view of the authorized Host Board. Frames are
 * whole-set replacements; only elapsed time and reconnect timing are local.
 */
export function createJobBoardStore(remote, options = {}) {
    return new RemoteJobBoardStore(remote, options);
}
