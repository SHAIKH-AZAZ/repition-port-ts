---
name: codebase-to-ts
description: "Convert an existing codebase (Python, JS, C#, etc.) to a TypeScript project. Use when the user asks to 'port this to TS', 'convert to TypeScript', 'create a TS version', 'make this TypeScript', or similar. Covers full-cycle conversion: source assessment, architecture mapping, type-safe conversion, project scaffolding, dependency migration, and build verification."
---

# Codebase-to-TypeScript Conversion

Systematic workflow for converting any language codebase to a production-quality TypeScript project.

## When to Use

- User asks to "port this to TS/TypeScript"
- User asks to "convert this codebase to JS/TS"
- User asks to "create a TypeScript version of this"
- Migrating a Python/JS/C#/etc. project to TypeScript
- Current project is a TS port of another codebase (e.g., Python → TS)

## Workflow

### Phase 1: Source Assessment (do this FIRST)

1. **Read the entire source codebase** — every file, every module. Do not skip files.
2. **Identify the language, framework, and runtime** of the source.
3. **Map the architecture**: entry points, core modules, data flow, external dependencies, config files, tests.
4. **Catalog all external dependencies** — what libraries does the source use? Find TS equivalents or compatible alternatives.
5. **Note domain-specific patterns**: error handling, async patterns, data structures, type equivalents.
6. **Produce a brief assessment**: what's the scope, what are the hard parts, what can be auto-converted vs. needs manual work.

### Phase 2: Project Scaffolding

1. Initialize TypeScript project (`tsconfig.json`, `package.json` with `"type": "module"`).
2. Set up project structure mirroring the source architecture.
3. Install TypeScript + type definitions for all dependencies.
4. Configure `tsc` with strict mode and appropriate target.
5. Set up scripts: `build`, `typecheck` (`tsc --noEmit`), `start`, `dev`.

### Phase 3: Core Conversion

Convert each module systematically, inside-out (dependencies first):

1. **Types first** — define TypeScript interfaces/types for all data structures before converting logic.
2. **Utility functions** — pure functions convert cleanly; map language-specific patterns:
   - Python `dict` → TS `Record<K,V>` or interfaces
   - Python `list` → TS arrays
   - Python `Optional[X]` → TS `X | null | undefined`
   - Python `*args/**kwargs` → TS rest params
   - Python decorators → TS higher-order functions or decorators (TS 5+)
   - C# properties → TS getters/setters or plain properties
3. **Core logic** — convert business logic with proper typing. Avoid `any`. Use generics where the source uses templates/generics.
4. **Async patterns** — Python `async/await` → TS `async/await` (direct). Python generators → TS generators or async iterables.
5. **Error handling** — map to typed errors or Result patterns as appropriate.
6. **Config/env** — use `dotenv` or equivalent. Type environment variables.

### Phase 4: Dependency Migration

For each external dependency in the source:
1. Find the TypeScript/Node.js equivalent.
2. Install with types (`@types/...`).
3. Rewrite imports and usages.
4. If no direct equivalent exists, write a thin adapter.

Common migrations:
- Python `openai` → TS `openai` npm package
- Python `requests` → TS `fetch` or `axios`
- Python `pdf2image` → TS `pdf-to-img` or `pdf.js`
- Python `PIL/Pillow` → TS `sharp`
- C# `Newtonsoft.Json` → TS native `JSON` or `zod` for validation

### Phase 5: Verification

1. **Typecheck passes**: `tsc --noEmit` exits 0.
2. **Build succeeds**: `tsc` produces `dist/` output.
3. **Runtime smoke test**: main entry point runs without crashes.
4. **Functional parity**: output matches source behavior on test inputs.
5. **No `any` leaks**: grep for `any` — replace with proper types.

## Output Format

When done, produce a summary:
- Files converted (count + list)
- Dependencies migrated (source lib → TS equivalent)
- Type coverage: % of files with zero `any`
- Build status: pass/fail
- Known gaps: anything that couldn't be ported cleanly

## Anti-patterns to Avoid

- Don't use `any` as a shortcut — find or create the proper type.
- Don't copy-paste source logic without understanding it — translate idiomatically.
- Don't skip tests — if the source had tests, port them too.
- Don't leave `console.log` debugging in production code.
- Don't ignore strict null checks — handle `null`/`undefined` explicitly.
