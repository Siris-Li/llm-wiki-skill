# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for issue operations.

## Pull requests as a triage surface

PRs as a request surface: no.

Do not include external pull requests in the triage queue unless this file is updated later.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `sdyckjq-lab/llm-wiki-skill`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Basic operations

- Create an issue with `gh issue create`.
- Read an issue with `gh issue view <number> --comments`.
- List issues with `gh issue list`.
- Comment with `gh issue comment <number>`.
- Apply or remove labels with `gh issue edit`.
- Close with `gh issue close`.

Infer the repo from `git remote -v`; `gh` does this automatically inside the clone.
