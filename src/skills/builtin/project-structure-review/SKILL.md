---
name: project-structure-review
description: Review a repository layout, detect important files, and summarize project architecture.
triggers:
  - project structure
  - repository structure
  - analyze project
  - architecture
  - overview
tools:
  - list_dir
  - glob_search
  - read_file
  - project_profile
  - code_outline
risk: low
---

# Skill: Project Structure Review

## When to use

Use this skill when the user asks for a project overview, directory analysis, architecture review, or entry-point discovery.

## Workflow

1. List the workspace root and important subdirectories.
2. Detect project command profile and package files.
3. Read README, architecture notes, package files, and small config files.
4. Use code outline or symbol search when code structure matters.
5. Summarize technology stack, main modules, commands, and risks.

## Output

- Technology stack
- Directory map
- Important files
- Development commands
- Risks or unknowns
