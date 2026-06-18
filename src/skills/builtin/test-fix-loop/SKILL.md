---
name: test-fix-loop
description: Run validation commands, parse failures, fix code, and rerun tests.
triggers:
  - test
  - failing
  - typecheck
  - lint
  - fix tests
  - validation
tools:
  - validation_plan
  - shell
  - parse_errors
  - read_file
  - edit_file
risk: medium
---

# Skill: Test Fix Loop

## When to use

Use this skill after code changes or when the user asks to run tests, fix failures, typecheck, or validate the project.

## Workflow

1. Detect validation commands.
2. Run the smallest relevant command first.
3. Parse failures into file, line, type, and message.
4. Inspect the failing code and related tests.
5. Apply a focused fix.
6. Rerun validation.
7. Stop after three failed repair attempts and report blocked status.

## Output

- Commands run
- Failures parsed
- Files changed
- Final validation status
- User action required, if any
