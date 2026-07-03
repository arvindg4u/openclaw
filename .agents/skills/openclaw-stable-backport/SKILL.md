---
name: openclaw-stable-backport
description: "Discover, assess, and prepare the complete security and reliability backport set for the most recently published OpenClaw stable release. Use when preparing its next maintenance patch, including direct commits and fixes without public PRs."
---

# OpenClaw Stable Backport

Prepare the next maintenance patch for the most recently published stable
release. One run discovers the full candidate set, obtains maintainer approval,
and prepares the approved targeted commits as one coordinated release batch.

Commits are canonical. PRs, issues, ClawSweeper reports, and advisories are
supporting context only.

## Boundaries

- Target the active line from checked-in stable release metadata when that
  tooling is available. Confirm its current version is the most recently
  published stable release. Do not default to an arbitrary branch or the older
  supported line.
- Review the complete mainline delta. Do not stop after finding the first few
  obvious fixes.
- Discover and present the proposed release set before changing release refs.
- Never push directly to a release branch or merge automatically.
- Never backport features, broad refactors, speculative hardening, or changes
  that require new config, migrations, APIs, protocols, dependencies, runtime
  requirements, or operator action.
- Read `SECURITY.md` and use `$security-triage` for security candidates. For an
  unpublished advisory or fix not yet public on `main`, stop the public
  workflow and hand off to `$openclaw-ghsa-maintainer` or another explicitly
  approved private-fork process. Never push its diff or open a public PR before
  the security owner authorizes disclosure.
- Use `$release-openclaw-maintainer` for release-branch/version policy,
  `$openclaw-testing` for proof selection, `$autoreview` before handoff, and
  `$openclaw-pr-maintainer` for GitHub operations.

## Resolve the Release

1. Run `git status -sb`. Do not overwrite unrelated work.
2. Fetch current tags and remote branches.
3. Inspect a detached worktree at the fetched `origin/main`. If
   `scripts/stable-release-lines.mjs` and `release/stable-lines.json` exist
   there, run
   `node scripts/stable-release-lines.mjs status --json` there and treat
   `.active` as authoritative. Record the pinned `origin/main` SHA plus its
   `baseVersion`, `currentVersion`, `branch`, published versions, rollback
   target, metadata digest, and metadata source SHA.
4. Query published GitHub releases and confirm the active `currentVersion` is
   the newest nonprerelease release. Confirm its tag is reachable from the
   active stable branch and the remote head matches the metadata contract.
5. Before stable-line metadata lands, fall back to the newest published stable
   tag and matching `origin/release/YYYY.M.PATCH` branch. Clearly report that
   the run is using the pre-stable-metadata fallback; do not guess a
   `stable/*` branch.
6. Use current release policy to determine the intended next maintenance
   version. Do not write stable metadata or invent a branch/version during
   discovery.

Useful release query:

```bash
gh release list --repo openclaw/openclaw --limit 50 \
  --exclude-drafts --exclude-pre-releases \
  --json tagName,publishedAt,isLatest
```

Example pinned metadata worktree:

```bash
metadata_ref=$(git rev-parse origin/main)
metadata_worktree=$(mktemp -d -t openclaw-stable-metadata.XXXXXX)
rmdir "$metadata_worktree"
git worktree add --detach "$metadata_worktree" "$metadata_ref"
metadata_status=$(cd "$metadata_worktree" && node scripts/stable-release-lines.mjs status --json)
git worktree remove "$metadata_worktree"
printf '%s\n' "$metadata_status"
```

If the newest stable release has no matching release branch, the tag is not
reachable from the metadata-selected target, metadata disagrees with GitHub,
or multiple branches appear authoritative, stop and report the mismatch before
discovery or mutation.

## Build the Complete Commit Inventory

Freeze `scan_end` to the current `origin/main` SHA. Resolve `scan_start` in this
order:

1. completed release evidence's recorded `scan_end` for the prior landed
   stable-backport batch on this line;
2. for the first run, the merge base between the stable branch and `main`;
3. an explicitly audited maintainer-provided mainline cursor when the histories
   are unrelated.

Do not rescan all history from the release branch cut on every maintenance
release. After the first complete ledger, each run accounts for all mainline
commits since the last accepted cursor. A stable closeout commit may prioritize
the newest batches, but it is not a safe first-run cursor because fixes can land
on `main` between the release branch cut and stable publication.

Never reuse a cursor from an open, unmerged, abandoned, or partially landed PR.
When using a completed cursor, also load every unresolved `blocked` candidate
from the accepted release evidence. Seed the new ledger with those
carry-forward items before classifying new commits. A cursor may advance only
when unresolved candidates remain durably recorded for the next run; do not
retire them merely because their source SHA is older than `scan_start`.

Example cursor resolution:

```bash
scan_end=$(git rev-parse origin/main)
scan_start=${PRIOR_ACCEPTED_SCAN_END:-}
if [[ -z "$scan_start" ]]; then
  if scan_start=$(git merge-base "<target-stable-ref>" origin/main); then
    :
  else
    echo "No merge base; resolve an audited mainline scan start" >&2
    exit 1
  fi
fi
if ! git merge-base --is-ancestor "$scan_start" "$scan_end"; then
  echo "scan_start is not an ancestor of scan_end" >&2
  exit 1
fi
git log --reverse --format='%H%x09%ad%x09%an%x09%s' --date=short \
  "$scan_start..$scan_end"
git cherry "<target-stable-ref>" "$scan_end" "$scan_start"
```

If histories are unrelated, resolve `scan_start` from release/promotion
evidence or a maintainer-provided mainline commit/tag and record that source.
If no auditable start exists, stop rather than guessing from dates or titles.

Create a local scratch ledger with one row per non-equivalent commit. Process
the inventory in deterministic batches of at most 100 commits so the full
range is reviewed without overflowing one model context. Record each SHA,
subject, changed paths, first-pass decision, and evidence still needed. The
ledger is review evidence, not a repository artifact; do not commit it.

```bash
ledger_dir=$(mktemp -d)
git rev-list --reverse "$scan_start..$scan_end" >"$ledger_dir/all-commits.txt"
git cherry "<target-stable-ref>" "$scan_end" "$scan_start" \
  >"$ledger_dir/patch-equivalence.txt"
split -l 100 "$ledger_dir/all-commits.txt" "$ledger_dir/batch-"
```

Review the subject and changed-file summary for every ledger entry. Then
inspect the full diff and surrounding code for every plausible security or
reliability fix. Account for merges, squash commits, direct commits, reordered
patches, stable-specific equivalents, and companion commits that `git cherry`
may not recognize. Do not finish discovery while any ledger entry remains
unclassified.

Also inspect:

- direct security and maintainer commits;
- linked PRs or issues when they exist;
- ClawSweeper commit reports and findings when available;
- follow-up commits needed to make an earlier fix complete;
- current source, callers, siblings, tests, and dependency contracts.

If `release/stable-plugin-support.json` and
`scripts/stable-plugin-backport-plan.ts` exist, treat them as authoritative for
the covered stable plugin set. For each candidate, identify affected covered
plugin ids and generate the dry-run plugin/core plan. Verify its stable line
and target branch match active stable metadata. Covered plugin fixes follow the
plan's plugin-first publication, core activation hold, validation, and partial
failure recovery order. Do not improvise coordination or silently include an
unlisted plugin.

If either authoritative plugin file is absent, classify any candidate that
changes an external plugin package, stable plugin version, or core/plugin
compatibility boundary as `blocked`. Do not include it in the public backport
batch until both checked-in files are available and the authoritative planner
succeeds.

```bash
node --import tsx scripts/stable-plugin-backport-plan.ts \
  --source-sha <sha> \
  --stable-line <YYYY.M.PATCH> \
  --eligibility-reason '<security-or-reliability reason>' \
  --affected-plugin-ids '<comma-separated ids>' \
  --manifest release/stable-plugin-support.json \
  --json
```

Shortlist material fixes such as crashes, hangs, restart loops,
data/session/message loss, auth/provider failures, serious regressions in
mature behavior, release/update/rollback failures, or bounded resource
exhaustion. Do not exclude a commit only because its title lacks `fix:` or it
has no PR.

## Reconcile Private Security Work

Before claiming the release set is complete, perform a confidential security
queue reconciliation with `$security-triage` and `$openclaw-ghsa-maintainer`:

1. Enumerate open/draft repository security advisories and their private-fork
   fix state using authorized maintainer access.
2. Determine privately whether each item affects the published stable tag.
3. Route applicable unpublished fixes through the approved private advisory
   workflow and expose only an opaque pending/cleared status in public release
   planning.
4. If advisory access is unavailable, require explicit security-owner
   confirmation before calling the candidate set complete.

Never copy advisory titles, exploit details, private SHAs, or private-fork refs
into the public ledger, branch, PR, or chat output.

## Assess Every Plausible Fix

For each candidate, prove:

1. The faulty behavior exists in the published stable tag or release branch.
2. For public fixes, the source commit is on `main` and is not already present
   or behaviorally equivalent on the release branch. Unpublished fixes remain
   in the approved private advisory workflow.
3. The change restores existing behavior rather than adding functionality.
4. The fix is complete with all required companion commits.
5. Stable-specific adaptation is narrow and preserves the same invariant.
6. Focused validation can prove the fix on the release branch.
7. Any covered plugin impact has a valid stable plugin backport plan and no
   unresolved manifest, target-version, or publish-order drift.

Classify each plausible fix as:

- `backport`: applicable, material, isolated, and testable;
- `already-covered`: commit or equivalent behavior is present;
- `not-affected`: the stable release does not contain the defect;
- `blocked`: useful fix, but adaptation or proof is unsafe or incomplete;
- `skip`: feature, low-impact change, refactor, or unsuitable stable change.

Do not infer that a clean cherry-pick is safe. Treat config/default, persisted
state, plugin/API boundary, protocol, dependency, packaging, installer, and
cross-repository changes as high risk requiring explicit maintainer judgment.

## Present the Full Release Set

Before mutation, report:

| Source commit | Decision | Stable impact | Dependencies | Adaptation | Proof |
| ------------- | -------- | ------------- | ------------ | ---------- | ----- |

Include:

- stable tag, metadata-selected target branch, intended maintenance tag, and
  scan start;
- frozen scan end, total commits inventoried, batch count, and the complete
  proposed backport set;
- dependency order for the targeted commits;
- affected covered plugins, generated plugin/core plans, and publish order;
- blocked or high-risk fixes that need a maintainer decision;
- carry-forward blocked candidates from prior release runs;
- skipped and already-covered fixes at a useful summary level;
- confidential security reconciliation status and unresolved applicability or
  validation gaps, without private details.

Use PR links only when they exist. Always retain source commit identities in
internal evidence. Stop and obtain explicit maintainer approval for the full
release set before changing branches.

## Prepare the Approved Patch Set

1. Create a fresh worktree from the metadata-selected stable branch, then
   create a separate backport staging branch from that exact remote head. When
   stable metadata is unavailable, use the confirmed pre-metadata release
   branch fallback.
2. Apply every approved public source commit individually in dependency order.
   Use `git cherry-pick -x` to retain provenance. Keep the commits separate and
   do not mix unrelated cleanup into conflict resolution.
3. After each cherry-pick, inspect the complete resulting diff against both the
   source commit and release branch. If adaptation becomes architectural, abort
   that candidate and return it to the release plan as `blocked`.
4. Backport or add focused regression tests where practical. Run focused proof
   for each fix, then run the combined changed-surface and release-relevant
   checks for the complete batch. Use Crabbox/Testbox for broad, package,
   cross-OS, release, or E2E proof.
5. For covered plugin changes, validate the generated plan, manifest digest,
   target versions, commit order, and all pre-merge tests. Do not publish any
   plugin or core package, run registry publish-proof, or activate the patch
   before the coordinated backport PR lands.
6. Run `$autoreview` on the complete final batch until no accepted/actionable
   findings remain.
7. Open one coordinated backport PR for the approved release set unless private
   security handling or current release tooling requires a separate PR. Target
   the metadata-selected stable branch, not `main`, and never push that target
   branch directly.
8. For unpublished security work, do not push any public branch or PR; remain
   in the approved private advisory fork until disclosure is authorized.

The backport PR body must list the intended maintenance tag, every source
commit and optional PR, why each fix affects stable, adaptations, focused proof,
combined proof, security status, rollback considerations, and the exact
`scan_start` and `scan_end`. The recorded `scan_end` becomes the next run's
cursor only after the backport decision set is complete and accepted. Record
all unresolved blocked candidates separately so they are carried into the next
run even after the cursor advances.

## Handoff

Report:

- published stable tag, metadata-selected target branch, and intended
  maintenance tag;
- complete included commit set and optional PRs;
- skipped, blocked, not-affected, and already-covered candidates;
- stable-specific adaptations and commit order;
- stable plugin plans, validation order, and any partial-failure state;
- exact validation commands, run IDs, and autoreview result;
- remaining security, release, or maintainer approvals;
- the coordinated backport PR URL or the precise reason no PR was opened;
- the next `$release-openclaw-maintainer` action after the backport PR lands;
- for covered plugins, the post-landing plugin publication and registry proof,
  then core publication, activation hold, and partial-failure recovery order.
