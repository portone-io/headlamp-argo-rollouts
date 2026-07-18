# headlamp-argo-rollouts

A [Headlamp](https://headlamp.dev) plugin that adds [Argo Rollouts](https://argoproj.github.io/rollouts/)
(`rollouts.argoproj.io`) support. Argo Rollouts are custom resources, so Headlamp's generic CR handling
knows neither how to roll them back nor how they own their ReplicaSets; this plugin fills both gaps.

## Features

### Revision history + rollback (detail page)

Adds a revision history section and a rollback button to the Argo Rollout detail page. The algorithm ports
Headlamp core's Deployment rollback (equivalent to `kubectl rollout undo`) to Rollout: it lists the
ReplicaSets owned by the Rollout, reads the revision from the `rollout.argoproj.io/revision` annotation,
copies the target revision's `spec.template`, drops the `rollouts-pod-template-hash` label, and applies a
`{op: replace, path: /spec/template}` JSON Patch to the Rollout. (Requires `patch` RBAC on
`rollouts.argoproj.io` for the cluster user.)

Argo Rollouts are custom resources, and Headlamp's generic custom-resource detail view renders only header
actions (not registered detail-view sections), so the entry point is a `registerDetailsViewHeaderAction`; the
component renders nothing for non-Rollout resources.

### Map view hierarchy

Adds a Rollout node and a Rollout→ReplicaSet ownership edge via `registerMapSource` so that, in the Map (graph)
view, the Rollout appears as the parent of the ReplicaSets it owns, drawing the same
Rollout→ReplicaSet→Pod hierarchy as the built-in Deployment→ReplicaSet→Pod. Enabled by default. Without it, a
Rollout's ReplicaSets render as top-level nodes because the built-in Map does not know the custom resource owns
them.

## Status & support

> **Heads-up:** this plugin was built for a proof-of-concept at [PortOne](https://portone.io) and is shared
> as-is. It is **not published to [Artifact Hub](https://artifacthub.io)** and is not maintained as a general
> community project, so it will not appear in Headlamp's Plugin Catalog. If it is useful to you, please **fork
> it** and adapt/maintain it for your own needs. No support or compatibility guarantees are provided.

## Install

Download the tarball from a [GitHub Release](https://github.com/portone-io/headlamp-argo-rollouts/releases)
and extract it into your Headlamp plugins directory so the layout is
`<plugins-dir>/headlamp-argo-rollouts/main.js`:

```bash
curl -sSL https://github.com/portone-io/headlamp-argo-rollouts/releases/download/v0.1.0/headlamp-argo-rollouts-0.1.0.tar.gz \
  | tar -xz -C <plugins-dir>
```

For the desktop app `<plugins-dir>` is Headlamp's plugins folder; for in-cluster deployments bake it into the
image under `/headlamp/plugins/`.

## Develop

```bash
npm install
npm run start   # run against a local Headlamp
npm run tsc     # type check
npm run lint
npm run build   # produce dist/main.js
npm run package # produce the distributable <name>-<version>.tar.gz (+ sha256)
```

Built on [`@kinvolk/headlamp-plugin`](https://github.com/headlamp-k8s/headlamp/tree/main/plugins/headlamp-plugin).

## License

[MIT](./LICENSE)
