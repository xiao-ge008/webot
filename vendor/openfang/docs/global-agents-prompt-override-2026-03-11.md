# Global AGENTS.md Prompt Injection (2026-03-11)

## Summary

This change promotes the global `AGENTS.md` (from Webot home) to the **highest-priority** system prompt section, ensuring it is always injected at the very top of the runtime system prompt for every agent and every turn.

Key goals:

1. Always include the global rules on every session.
2. Make it higher priority than all other prompt sections.
3. Ensure the source is `~/.webot/AGENTS.md` (via `config.home_dir`), not per-workspace `AGENTS.md`.

## Behavior Changes

- **Before**: `AGENTS.md` was loaded from each agent workspace and injected mid-prompt (Section 2.5).
- **After**: `AGENTS.md` is loaded from `config.home_dir/AGENTS.md` and injected as **Section 0** at the top of the system prompt.

## Files Changed

1. `crates/openfang-runtime/src/prompt_builder.rs`
   - Inject global AGENTS content first (Section 0).
   - Remove the old mid-prompt insertion.
2. `crates/openfang-kernel/src/kernel.rs`
   - Load `AGENTS.md` from `config.home_dir` (Webot/OpenFang home), not workspace.

## Upgrade Notes

If upstream changes overwrite these files, re-apply the changes to:

- `crates/openfang-runtime/src/prompt_builder.rs`
- `crates/openfang-kernel/src/kernel.rs`

## Verification

At runtime, check the system prompt ordering:

1. Global `AGENTS.md` content appears first.
2. Agent identity and other sections follow.

