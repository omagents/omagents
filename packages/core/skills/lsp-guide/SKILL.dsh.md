---
name: lsp-guide
description: "Guide DSH agents to the right code intelligence tool: an actually exposed native LSP tool, codegraph MCP, grep, glob, ast-grep, or project diagnostics."
---

# DSH Code Intelligence Guide

Choose tools from the current DSH session's actual tool catalog. DSH 0.2.2 does not use another host's LSP configuration or feature flags. If a native `lsp` tool is exposed by the active composition, use its advertised schema; otherwise use codegraph, search, and project-native checks.

## Decision Tree

```text
What do you need?
│
├─ Definition / reference / hover / symbol / rename
│  ├─ If native `lsp` is visible: use its exposed operation schema
│  └─ Otherwise: use `mcp__codegraph__codegraph_explore`, `grep`, and `glob`
│
├─ Call path / impact radius / blast radius
│  └─ Use `mcp__codegraph__codegraph_explore`
│     Supply relevant symbol/file terms and an absolute project path when required.
│
├─ Precise text or regex search
│  └─ Use native `grep`
│
├─ File pattern matching
│  └─ Use native `glob`
│
├─ AST pattern matching or structural rewrite
│  └─ Use the `ast-grep` skill when available; otherwise use `grep`
│
└─ Diagnostics (errors/warnings)
   ├─ Use native `lsp` diagnostics only if that operation is actually exposed
   └─ Otherwise run the project's typechecker, linter, or tests through `bash`
```

## Tool Selection Rules

- **Native LSP:** use only when the active DSH tool registry advertises it. Follow the installed schema instead of inventing operation names or setting environment variables.
- **Codegraph:** preferred for architecture, symbol relationships, call paths, and change blast radius. Its DSH MCP name is `mcp__codegraph__codegraph_explore`.
- **Search:** `grep` is faster for simple text; `glob` is the right file-listing tool.
- **AST-aware changes:** use `ast-grep` for structural patterns across supported languages.
- **Project-wide diagnostics:** the project's own typechecker/linter/test command is the reliable fallback and often the best authoritative check.

## Language Servers

Language-server availability is deployment-specific. Common server choices include TypeScript/JavaScript (`typescript`), Python (`pyright`), Rust (`rust-analyzer`), Go (`gopls`), Java (`jdtls`), C/C++ (`clangd`), C# (`csharp`), Swift (`sourcekit-lsp`), and YAML (`yaml-ls`). Their presence in this list does not prove that the active DSH profile installed or exposed them.

## When Not to Use LSP

- Quick text search: use `grep`.
- File discovery: use `glob`.
- Architecture and call paths: use codegraph.
- Cross-language structural patterns: use `ast-grep`.
- Large refactors: use the `refactor` skill and its verified loop queue.
- No advertised LSP capability: do not stop; fall back to codegraph plus project-native diagnostics.

## Verification Tips

- LSP servers may start on demand and consume significant memory; prefer search for small questions.
- After a rename or structural edit, run the affected tests and the project's typechecker/linter.
- Do not edit configuration or set flags for a different host to make an LSP tool appear.
