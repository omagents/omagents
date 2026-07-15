---
name: lsp-guide
description: "Guide agents to use the right code intelligence tool: OpenCode's native LSP, codegraph MCP, grep, or ast-grep. Trigger when the agent needs code navigation, definition lookup, reference finding, renaming, or diagnostics."
---

# LSP Guide: Choose the Right Code Intelligence Tool

OpenCode has built-in LSP support. This skill helps you choose the right tool for each job.

## When to Use

- You need to find a definition, reference, or symbol
- You need to rename a symbol across the codebase
- You need diagnostics (errors/warnings) for a file
- You need to understand call paths or impact radius

## Prerequisites

LSP must be enabled in the project:

```json
// opencode.json
{ "lsp": true }
```

The `lsp` tool is experimental. Set this environment variable:
```bash
export OPENCODE_EXPERIMENTAL_LSP_TOOL=true
```

## Decision Tree

```
What do you need?
│
├─ Definition / Reference / Hover / Symbol
│  └─ Use OpenCode's built-in `lsp` tool
│     Operations: goToDefinition, findReferences, hover,
│                 documentSymbol, workspaceSymbol,
│                 goToImplementation, incomingCalls, outgoingCalls
│
├─ Call path / Impact radius / Blast radius
│  └─ Use codegraph MCP: codegraph_codegraph_explore
│     Returns verbatim source + call paths between symbols
│
├─ Precise text search (regex)
│  └─ Use grep tool (ripgrep under the hood)
│
├─ File pattern matching
│  └─ Use glob tool
│
├─ AST pattern matching / structural rewrite
│  └─ Use ast-grep skill (if installed) or fallback to grep
│
└─ Diagnostics (errors/warnings)
   └─ Use `lsp` tool with lsp_diagnostics
      OR run the project's linter directly via bash
```

## Language Mapping

OpenCode auto-detects LSP servers by file extension:

| Language | LSP Server | Extensions |
|----------|-----------|------------|
| TypeScript/JavaScript | typescript | .ts .tsx .js .jsx .mjs |
| Python | pyright | .py .pyi |
| Rust | rust-analyzer | .rs |
| Go | gopls | .go |
| Java | jdtls | .java |
| C/C++ | clangd | .c .cpp .h .hpp |
| Ruby | ruby-lsp | .rb |
| PHP | intelephense | .php |
| C# | csharp | .cs |
| Swift | sourcekit-lsp | .swift |
| Lua | lua-ls | .lua |
| Bash | bash-language-server | .sh .bash .zsh |
| YAML | yaml-ls | .yaml .yml |

Full list: https://opencode.ai/docs/lsp/

## When NOT to Use LSP

- **Quick text search**: grep is faster for simple string matching
- **File listing**: glob is the right tool
- **Understanding architecture**: codegraph gives call paths and blast radius
- **Cross-language pattern matching**: ast-grep handles structural patterns
- **Large refactors**: use refactor skill with loop_engine for file-by-file verification

## Tips

- LSP servers start on demand when a matching file extension is detected
- LSP can be memory-intensive; for quick tasks, grep may be more efficient
- If LSP is not enabled, fall back to grep + codegraph
- For project-wide diagnostics, run the linter via bash instead of per-file LSP
