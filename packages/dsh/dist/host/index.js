import { createDshRuntime } from "./runtime.js";
export { createDshRuntime } from "./runtime.js";
export const name = "omagents";
export const inject = ["loader"];
export async function apply(ctx) {
    const runtime = await createDshRuntime(ctx);
    ctx.effect(() => () => runtime.dispose(), "omagents runtime");
    ctx.provide("omagents", runtime);
}
