---
name: python-data-analysis
description: Use Python to inspect files, run calculations, analyze data, and summarize results.
triggers:
  - python
  - script
  - data
  - statistics
  - analyze
  - run script
tools:
  - python_exec
  - python_run_file
  - python_write_and_run
  - read_file
  - write_file
risk: medium
---

# Skill: Python Data Analysis

## When to use

Use this skill when the user asks to write or run Python, inspect files with a script, compute metrics, process data, or run a small local experiment.

## Workflow

1. Clarify the analysis target from the user request and existing workspace context.
2. Inspect relevant files without reading sensitive paths.
3. Write a Python script under `.code-agent/tmp/` when a repeatable script is useful.
4. Run the script with `python_run_file` or `python_write_and_run`.
5. Analyze stdout, stderr, exit code, duration, and artifacts.
6. If the run fails, fix the script and retry up to three times.
7. Summarize script path, input data, result, errors, and limits.

## Output

- Script path
- Inputs inspected
- Execution result
- Errors or limits
- Next steps
