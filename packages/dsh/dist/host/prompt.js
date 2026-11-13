import { buildJobBoardContext, listSkillDefinitions, renderSkillForHost } from "@omagents/core";
export const DSH_PARALLEL_SECTION_NAME = "omagents:parallel-execution";
export const DSH_JOB_BOARD_CONTEXT_NAME = "omagents:job-board-state";
export const DSH_PARALLEL_INSTRUCTIONS = `<Parallel_Execution>
You can coordinate independent work with native DSH subagents and the shared Job Board.

## When to parallelize
- Research multiple independent questions.
- Explore separate parts of a codebase.
- Implement independent changes whose write scopes do not conflict.

## How to parallelize
1. Decompose the request into self-contained subtasks.
2. Start native DSH \`subagent\` delegations concurrently and continue useful work while they run.
3. Do not poll running jobs. Native lifecycle delivery reports completion; use \`parallel_status\` only when you need a read-only status snapshot.
4. Acknowledge pending outcomes shown by the Job Board before your final response, then synthesize the results.
5. For dependent work, use the first job's outcome as input to the next delegation.

For trivial work or tiny mechanical edits, act directly instead of delegating.
</Parallel_Execution>`;
export const DSH_SUPERPOWERS_TOOL_MAPPING = `**Tool Mapping for DeepSeek Harness (DSH 0.2.2):**
When Superpowers skills request actions, use these native DSH equivalents:
- Ask a structured question → \`ask_user_question\` when available; otherwise ask one focused question in chat.
- Create or update todos (including older TodoWrite references) → \`todo_write\`.
- \`Subagent (general-purpose):\` or any implementer/reviewer/research delegation → native \`subagent\` with \`description\` and a self-contained \`prompt\`, plus optional \`cwd\`. DSH starts it asynchronously and returns its activation; do not add another host's launch arguments.
- Invoke a skill, including \`superpowers:<name>\` notation → native \`skill\` with the exact unqualified catalog \`name\`. DSH publishes the session catalog automatically; do not load \`using-superpowers\` again.
- Read files → \`read\`.
- Create or overwrite files → \`write\`; targeted literal changes → \`edit\`; multi-file or separated changes → \`apply_patch\`.
- Run shell commands → \`bash\`.
- Search file contents or paths → \`grep\` and \`glob\`.
- Fetch a URL → \`web_fetch\`; search the web → \`web_search\`.
- MCP calls → the advertised \`mcp__<server>__<raw_tool>\` name, such as \`mcp__codegraph__codegraph_explore\`.

Keep dependent delegations sequential. Start only independent delegations together, and use each child's authoritative result before synthesis.`;
let cachedSuperpowersBootstrap;
/** Build the DSH-native Superpowers controller bootstrap from Core's selected skill. */
export function buildDshSuperpowersBootstrap() {
    if (cachedSuperpowersBootstrap !== undefined)
        return cachedSuperpowersBootstrap;
    const definition = listSkillDefinitions({ host: "dsh" }).find((skill) => skill.source === "superpowers" && skill.name === "using-superpowers");
    if (!definition) {
        cachedSuperpowersBootstrap = "";
        return cachedSuperpowersBootstrap;
    }
    const { body } = renderSkillForHost(definition, "dsh");
    cachedSuperpowersBootstrap = `<EXTREMELY_IMPORTANT>
You have superpowers.

**IMPORTANT: The using-superpowers skill content is included below. It is ALREADY LOADED - you are currently following it. Do NOT use the skill tool to load "using-superpowers" again - that would be redundant.**

${body}

${DSH_SUPERPOWERS_TOOL_MAPPING}
</EXTREMELY_IMPORTANT>`;
    return cachedSuperpowersBootstrap;
}
/** Keep controller workflows out of delegated children while retaining their native skills. */
export function buildDshTopLevelInstructions(isSubagent = false) {
    const bootstrap = isSubagent ? "" : buildDshSuperpowersBootstrap();
    return bootstrap ? `${bootstrap}\n\n${DSH_PARALLEL_INSTRUCTIONS}` : DSH_PARALLEL_INSTRUCTIONS;
}
export const DSH_STATE_PRESERVATION_NOTE = `## OmAgents State Preservation
This operational context is regenerated from durable state for model requests, including after compaction; compacted conversation history is not its only copy.
If you were processing a loop_engine task queue, run:
  loop_engine.py status <skill>
  loop_engine.py next <skill>
to resume where you left off.
If you had delegated jobs running, use parallel_status to inspect their durable state without changing their notification state.`;
/** Build a fresh required runtime snapshot; no compactable message history is consulted. */
export function buildDshStatePreservationContext(board, parentSessionId) {
    const boardContext = parentSessionId === undefined ? "" : buildJobBoardContext(board, parentSessionId);
    return boardContext
        ? `${DSH_STATE_PRESERVATION_NOTE}\n\n${boardContext}`
        : DSH_STATE_PRESERVATION_NOTE;
}
