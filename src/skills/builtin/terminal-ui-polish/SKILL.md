---
name: terminal-ui-polish
description: Improve terminal UI rendering, trace summaries, diffs, Markdown output, and fixed composer behavior.
triggers:
  - terminal ui
  - cli
  - tui
  - trace
  - markdown
  - diff renderer
  - composer
tools:
  - read_file
  - grep_search
  - edit_file
  - shell
risk: medium
---

# Skill: Terminal UI Polish

## When to use

Use this skill when the user asks to improve CLI output, streaming display, slash menus, trace rendering, Markdown rendering, or fixed-bottom composer behavior.

## Workflow

1. Inspect CLI rendering and REPL files before editing.
2. Keep runtime events separate from presentation rendering.
3. Preserve fixed-bottom composer, scroll history, streaming, and transcript behavior.
4. Add focused tests for rendering and key interactions.
5. Run typecheck and test commands.

## Output

- UI behavior changed
- Files changed
- Tests run
- Known terminal limitations
