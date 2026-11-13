var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, TypertRemoteService, } from "@deepseek-ai/dsh-typert-protocol";
import { badJobRequest, cancellationFailed, jobNotFound, scopeDenied, } from "./remote-access.js";
function normalizeScope(scope) {
    if (typeof scope !== "object" || scope === null || Array.isArray(scope)) {
        throw badJobRequest("scope", "scope must be an object");
    }
    if (Object.keys(scope).some((key) => key !== "parentSessionId")) {
        throw badJobRequest("scope", "scope accepts only parentSessionId");
    }
    const { parentSessionId } = scope;
    if (parentSessionId !== undefined &&
        (typeof parentSessionId !== "string" || parentSessionId.length === 0)) {
        throw badJobRequest("scope.parentSessionId", "parentSessionId must be a non-empty string");
    }
    return parentSessionId === undefined ? {} : { parentSessionId };
}
function normalizeJobId(jobId) {
    if (typeof jobId !== "string" || jobId.length === 0) {
        throw badJobRequest("jobId", "jobId must be a non-empty string");
    }
    return jobId;
}
function cloneJob(job) {
    return structuredClone(job);
}
/** A single pending slot coalesces bursts without ever withholding the newest frame. */
class LatestFrameQueue {
    latest;
    failure;
    wake;
    closed = false;
    push(frame) {
        if (this.closed)
            return;
        this.latest = frame;
        this.notify();
    }
    fail(error) {
        if (this.closed)
            return;
        this.failure = { error };
        this.latest = undefined;
        this.notify();
    }
    discardThrough(revision) {
        if (this.latest && this.latest.revision <= revision)
            this.latest = undefined;
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.latest = undefined;
        this.notify();
    }
    async take() {
        while (!this.closed && !this.latest && !this.failure) {
            let wake;
            const waiting = new Promise((resolve) => {
                wake = resolve;
            });
            this.wake = wake;
            await waiting;
            if (this.wake === wake)
                this.wake = undefined;
        }
        if (this.failure)
            throw this.failure.error;
        if (this.closed)
            return undefined;
        const frame = this.latest;
        this.latest = undefined;
        return frame;
    }
    notify() {
        const wake = this.wake;
        this.wake = undefined;
        wake?.();
    }
}
/** Authorized Remote face of the active profile's Core Board. */
let OmAgentsRemote = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _listJobs_decorators;
    let _cancelJob_decorators;
    let _getHealth_decorators;
    let _watchJobs_decorators;
    return class OmAgentsRemote extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _listJobs_decorators = [Remote];
            _cancelJob_decorators = [Remote];
            _getHealth_decorators = [Remote];
            _watchJobs_decorators = [Remote({ mode: "stream" })];
            __esDecorate(this, null, _listJobs_decorators, { kind: "method", name: "listJobs", static: false, private: false, access: { has: obj => "listJobs" in obj, get: obj => obj.listJobs }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _cancelJob_decorators, { kind: "method", name: "cancelJob", static: false, private: false, access: { has: obj => "cancelJob" in obj, get: obj => obj.cancelJob }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getHealth_decorators, { kind: "method", name: "getHealth", static: false, private: false, access: { has: obj => "getHealth" in obj, get: obj => obj.getHealth }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _watchJobs_decorators, { kind: "method", name: "watchJobs", static: false, private: false, access: { has: obj => "watchJobs" in obj, get: obj => obj.watchJobs }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        board = __runInitializers(this, _instanceExtraInitializers);
        tracker;
        health;
        authorizeScope;
        lifetime = new AbortController();
        constructor(ctx, options) {
            // Keep the wire namespace distinct from the runtime's ctx.omagents service key.
            super(ctx, "omagentsRemote", { namespace: "omagents" });
            this.board = options.board;
            this.tracker = options.tracker;
            this.health = options.health;
            this.authorizeScope = options.authorizeScope;
            ctx.effect(() => () => this.lifetime.abort(), "omagents Remote watch streams");
        }
        async listJobs(scope) {
            const normalized = normalizeScope(scope);
            this.assertAuthorized(normalized, "omagents/listJobs", "session-scope-unauthorized");
            return this.readJobs(normalized);
        }
        async cancelJob(jobId) {
            const normalized = normalizeJobId(jobId);
            const job = this.board.get(normalized);
            if (!job)
                throw jobNotFound(normalized);
            this.assertAuthorized({ parentSessionId: job.parentSessionId }, "omagents/cancelJob", "job-unauthorized");
            if (job.executionState === "running") {
                try {
                    await this.tracker.cancel(job);
                }
                catch (error) {
                    throw cancellationFailed(job.id, error);
                }
            }
            const current = this.board.get(job.id);
            if (!current)
                throw jobNotFound(normalized);
            return cloneJob(current);
        }
        getHealth() {
            return structuredClone(this.health);
        }
        watchJobs(scope, signal) {
            return {
                [Symbol.asyncIterator]: () => {
                    let close = () => { };
                    const iterator = this.streamJobs(scope, signal, (closeStream) => {
                        close = closeStream;
                    })[Symbol.asyncIterator]();
                    return {
                        next: () => iterator.next(),
                        return: async () => {
                            // AsyncGenerator return() is queued behind a pending next(). Close
                            // first so that next can finish and the queued return can settle.
                            close();
                            return iterator.return(undefined);
                        },
                        throw: async (error) => {
                            close();
                            return iterator.throw(error);
                        },
                    };
                },
            };
        }
        async *streamJobs(scope, signal, registerClose) {
            const normalized = normalizeScope(scope);
            this.assertAuthorized(normalized, "omagents/watchJobs", "session-scope-unauthorized");
            const lifetime = AbortSignal.any([signal, this.lifetime.signal]);
            if (lifetime.aborted)
                return;
            const queue = new LatestFrameQueue();
            // Subscribe before taking the baseline. The pending slot retains any commit
            // racing the baseline, while discardThrough suppresses only stale duplicates.
            const unsubscribe = this.board.subscribe(() => {
                try {
                    queue.push(this.frame(normalized));
                }
                catch (error) {
                    queue.fail(error);
                }
            });
            const close = () => {
                queue.close();
                // An AsyncGenerator suspended at yield has no pending finally transition;
                // closure itself must still release the Core listener immediately.
                unsubscribe();
            };
            registerClose(close);
            lifetime.addEventListener("abort", close, { once: true });
            try {
                const baseline = this.frame(normalized);
                queue.discardThrough(baseline.revision);
                if (lifetime.aborted)
                    return;
                yield baseline;
                while (!lifetime.aborted) {
                    const frame = await queue.take();
                    if (!frame)
                        return;
                    yield frame;
                }
            }
            finally {
                lifetime.removeEventListener("abort", close);
                close();
            }
        }
        assertAuthorized(scope, action, reason) {
            if (!this.authorizeScope(this.ctx, scope))
                throw scopeDenied(action, reason);
        }
        readJobs(scope) {
            return this.board
                .list(scope)
                .filter((job) => this.authorizeScope(this.ctx, { parentSessionId: job.parentSessionId }))
                .map(cloneJob);
        }
        frame(scope) {
            return { revision: this.board.revision, jobs: this.readJobs(scope) };
        }
    };
})();
export { OmAgentsRemote };
