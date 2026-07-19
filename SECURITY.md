# Security Policy

## Scope

`headlamp-argo-rollouts` is a **frontend-only** Headlamp plugin. It ships no
backend and adds no new network endpoints: it talks only to the Kubernetes API
through Headlamp, using the logged-in user's credentials and RBAC. Mutating
actions (rollback, promote/pause/abort/etc., Set Image) are plain Kubernetes
patches, and the UI hides them when the user lacks `patch` permission (checked
via a `SelfSubjectAccessReview`). RBAC on the cluster remains the source of
truth for what any user can actually do.

## Supported versions

Only the latest released version receives fixes. This plugin is shared as-is
without a support guarantee (see the README); forks are encouraged to maintain
their own line.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** via GitHub's
[private vulnerability reporting](https://github.com/portone-io/headlamp-argo-rollouts/security/advisories/new)
rather than opening a public issue. Include steps to reproduce and the affected
version. We'll acknowledge the report and follow up with a fix or an assessment.
