# Releasing

[Changesets](https://github.com/changesets/changesets) automates releases. GitHub Actions publishes them to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers), which uses the GitHub Actions OIDC token. No npm token exists anywhere: not in the repo secrets, and not on a maintainer's machine.

## Day-to-day flow

1. Land PRs with changeset files as usual (`pnpm changeset`).
2. On every push to `main`, the release workflow updates the Version Packages PR. That PR collects the pending changesets into a version bump and changelog.
3. Merge the Version Packages PR. This puts an unpublished version on `main`. The workflow detects it and queues the `publish` job against the `release` environment, which waits for reviewer approval.
4. Approve the deployment. The job runs typecheck, lint, format check, build, and tests again on the exact tree it will publish. Then `changeset publish` publishes with provenance, pushes the `coily@x.y.z` git tag, and creates the GitHub Release.

A push to `main` that leaves nothing to publish never requests approval. This happens when the current version is already on npm, or when changesets are still pending.

## One-time setup

Do these steps on GitHub before you merge the workflows:

1. In Settings, open Environments and create an environment named `release`. Add tkofh as a required reviewer, and restrict deployment branches to `main`. Do not skip this step. If the environment does not exist, GitHub creates it on first use _without_ protection rules, and a publish then runs without approval.
2. In Settings, open Actions, then General, then Workflow permissions. Keep the default token read-only. Enable _Allow GitHub Actions to create and approve pull requests_, which the Version Packages PR needs.
3. In Settings, open Actions, then General, then Actions permissions. Select _Allow tkofh, and select non-tkofh, actions and reusable workflows_. Check _Allow actions created by GitHub_, and allowlist `pnpm/action-setup@*,changesets/action@*`. Also enable _Require actions to be pinned to a full-length commit SHA_, so that GitHub refuses an action pinned to a tag or a branch.

Do this step on npm before you approve the first publish:

4. On npmjs.com, open the `coily` package, then Settings, then Trusted publisher. Select GitHub Actions with organization `tkofh`, repository `coily`, workflow `release.yml`, and environment `release`. Grant the `npm publish` permission only, not `npm stage publish`. The human approval step here is the `release` environment, and `changeset publish` cannot drive staged publishing ([changesets#2025](https://github.com/changesets/changesets/issues/2025)). The equivalent CLI command needs npm 11.15 or later and 2FA: `npm trust github --repo tkofh/coily --file release.yml --env release --allow-publish`. Until you configure this, the OIDC exchange fails and the publish job errors. Configure it, then run the job again.

Do this step on npm after the first successful trusted publish:

5. On npmjs.com, open the `coily` package, then Settings, then Publishing access. Switch to the option that allows only trusted publishers and disallows tokens. Then revoke any remaining npm tokens with publish rights to `coily`. After this, nobody can run `npm publish` for `coily` from a laptop.

## Caveats

- CI on the Version Packages PR needs a manual approval. `github-actions[bot]` authors the PR, so GitHub holds its CI run as "awaiting approval". Click _Approve workflow and run_ on the PR to run it. New changesets that land on `main` force-push the PR branch, and each update queues the approval again. The publish job runs the full verification again in any case, so an unapproved CI run never means that unverified code ships. If `main` ever gets required status checks, you must click the approval before you merge.
- Version commits and release tags are signed. With `commitMode: github-api`, Changesets creates commits and tags through the GitHub API. GitHub signs them with GPG and attributes them to `github-actions[bot]`. This satisfies a verified-signatures branch rule if `main` ever gets one.
- Recover from a partial failure by hand. Sometimes the publish succeeds on npm, but the tag push or the GitHub Release fails. A plain re-run then skips the publish, because the gate sees that the version is on npm. Push the tag yourself: `git tag coily@<version> && git push origin coily@<version>`.
- A version can be superseded. If another changeset lands on `main` between the merge of a Version Packages PR and its publish run, the gate holds that version back. It ships with the next Version Packages PR instead.
