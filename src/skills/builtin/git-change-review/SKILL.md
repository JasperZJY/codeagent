---
name: git-change-review
description: Inspect git changes, checkpoint, revert agent changes, and draft commit messages.
triggers:
  - git
  - diff
  - changes
  - checkpoint
  - revert
  - commit message
tools:
  - git_status
  - git_diff
  - changes_summary
  - checkpoint_create
  - revert_changes
  - git_commit_message
risk: medium
---

# Skill: Git Change Review

## When to use

Use this skill when the user asks to inspect changes, compare diffs, create checkpoints, revert this agent's changes, or prepare a commit message.

## Workflow

1. Create a checkpoint before modifications when possible.
2. Inspect current git status and agent-tracked changes.
3. Show concise diff summaries.
4. Only revert files changed by the current agent checkpoint.
5. Draft a commit message from observable changes.

## Output

- Changed files
- Diff summary
- Checkpoint or revert status
- Commit message draft
