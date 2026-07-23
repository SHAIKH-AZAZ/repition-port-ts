---
name: codebase-audit
description: "Perform a thorough audit of a codebase: read every source file, identify pending/incomplete work, find bugs, map architecture, and produce a structured audit report. Use when the user asks to 'read this codebase properly', 'check what is pending', 'what's incomplete', 'audit this project', 'review this codebase', or similar exploratory entry points."
---

# Codebase Audit

Systematic workflow for fully understanding a codebase and producing a structured audit of its state, pending work, and issues.

## When to Use

- User says "read this codebase properly" or "read this codebase in detail"
- User says "check what is pending" or "what's incomplete"
- User says "audit this project" or "review this codebase"
- User pastes a codebase path and asks to understand it
- First session on an unfamiliar project — establish baseline understanding

## Workflow

### Phase 1: Structure Discovery

1. **List all directories and files** — use glob patterns to map the full tree.
2. **Read config files first**: `package.json`, `tsconfig.json`, `.env.example`, `docker-compose.yml`, `Makefile`, etc.
3. **Identify the tech stack**: language, framework, runtime, build system, test framework.
4. **Map entry points**: main files, CLI entry, API entry, test entry.
5. **Note the directory structure convention**: monorepo? microservices? flat?

### Phase 2: Source Reading

**Read every source file.** Do not skip files. Use parallel reads when possible.

For each file, note:
- Purpose / responsibility
- Exports (public API)
- Imports (dependencies on other project files)
- External dependencies used
- Any TODO/FIXME/HACK/XXX comments
- Error handling patterns
- Test coverage (are there tests for this?)

### Phase 3: Architecture Mapping

1. **Data flow**: How does data move through the system? Entry → processing → output.
2. **Module boundaries**: Which modules are independent? Which are tightly coupled?
3. **External integrations**: APIs, databases, file systems, third-party services.
4. **Configuration surface**: What's configurable? Where are config values read?

### Phase 4: Pending Work Identification

Systematically check for:

1. **Incomplete features**: TODO comments, half-implemented functions, empty test files.
2. **Missing tests**: Files with no corresponding test file.
3. **Build issues**: Does `tsc --noEmit` / `npm run build` pass? Any warnings?
4. **Dependency issues**: Outdated packages, missing type definitions, peer dependency conflicts.
5. **Code quality**: `any` types, commented-out code, dead code, duplicated logic.
6. **Missing infrastructure**: No CI/CD, no linting, no formatting config, no `.env.example`.
7. **Documentation gaps**: Missing README sections, undocumented APIs, no inline docs for complex logic.

### Phase 5: Audit Report

Produce a structured report with these sections:

```markdown
## Codebase Audit: <project name>

### Tech Stack
- Language, framework, runtime, build tool, test framework

### Architecture Summary
- <1-3 sentence description of what the project does and how>

### File Map
| Directory | Purpose | Files |
|-----------|---------|-------|
| src/      | ...     | N     |

### Pending Work (Prioritized)
| Priority | Item | Location | Description |
|----------|------|----------|-------------|
| P0       | ...  | file:line | ... |
| P1       | ...  | file:line | ... |

### Build Status
- Typecheck: ✅/❌
- Build: ✅/❌
- Tests: ✅/❌ (N passing, M failing, K missing)

### Key Findings
- <notable patterns, strengths, risks>

### Recommended Next Steps
1. ...
2. ...
```

## Tips

- When the user says "read this codebase properly", they want DEPTH — don't just skim the entry point.
- If the codebase is large, prioritize: entry points → core modules → utilities → tests.
- If there are image/screenshot references in the user's message, address them.
- When you find bugs or issues, note them in the audit but don't fix them unless asked.
- If the user follows up with "check for X", that's a focused sub-audit — narrow the scope to that area.

## Anti-patterns to Avoid

- Don't just read the README and claim you understand the codebase.
- Don't skip "boring" files (types, configs, utilities) — they often hold important context.
- Don't produce a vague summary — be specific about file paths, function names, line numbers.
- Don't mix audit findings with fixes — keep them separate unless the user asks to fix.
