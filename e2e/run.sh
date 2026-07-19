#!/usr/bin/env bash
# End-to-end screenshot capture: spin up kind + Argo Rollouts + a sample Rollout,
# run Headlamp (this plugin baked in) in Docker, and drive it with Playwright to
# refresh docs/screenshots/. Used by the screenshots workflow and runnable
# locally. Set KEEP=1 to skip teardown for debugging.
set -euo pipefail

CLUSTER="${CLUSTER:-hl-verify}"
HL_PORT="${HL_PORT:-4466}"
HL_IMAGE="${HL_IMAGE:-ghcr.io/headlamp-k8s/headlamp:v0.43.0}"
HL_URL="http://localhost:${HL_PORT}"
PW_DEPS="${PW_DEPS:-}" # set to "--with-deps" on Debian/Ubuntu CI runners
KEEP="${KEEP:-}"

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${E2E_DIR}/.." && pwd)"
WORK="$(mktemp -d)"
KUBECONFIG_FILE="${WORK}/config"

log() { echo "▸ $*"; }

teardown() {
  [ -n "${KEEP}" ] && { log "KEEP set, leaving cluster/container up"; return; }
  log "Teardown"
  docker rm -f hl-e2e >/dev/null 2>&1 || true
  kind delete cluster --name "${CLUSTER}" >/dev/null 2>&1 || true
  rm -rf "${WORK}"
}
trap teardown EXIT

# --- kind cluster ------------------------------------------------------------
if ! command -v kind >/dev/null 2>&1; then
  log "Installing kind"
  curl -fsSLo "${WORK}/kind" https://kind.sigs.k8s.io/dl/v0.30.0/kind-linux-amd64
  chmod +x "${WORK}/kind"
  export PATH="${WORK}:${PATH}"
fi

log "Creating kind cluster ${CLUSTER}"
kind delete cluster --name "${CLUSTER}" >/dev/null 2>&1 || true
kind create cluster --name "${CLUSTER}"
CTX="kind-${CLUSTER}"

log "Installing Argo Rollouts"
kubectl --context "${CTX}" create namespace argo-rollouts
kubectl --context "${CTX}" apply -n argo-rollouts \
  -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml
kubectl --context "${CTX}" -n argo-rollouts rollout status deploy/argo-rollouts --timeout=180s

# --- sample Rollout: reach Paused mid-canary with an AnalysisRun --------------
log "Applying sample Rollout"
kubectl --context "${CTX}" apply -f "${E2E_DIR}/sample-rollout.yaml"
kubectl --context "${CTX}" -n demo wait --for=jsonpath='{.status.phase}'=Healthy \
  rollout/demo-canary --timeout=180s
log "Triggering canary (revision 2)"
kubectl --context "${CTX}" -n demo patch rollout demo-canary --type merge \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"app","image":"argoproj/rollouts-demo:yellow"}]}}}}'
for _ in $(seq 1 30); do
  phase="$(kubectl --context "${CTX}" -n demo get rollout demo-canary -o jsonpath='{.status.phase}')"
  [ "${phase}" = "Paused" ] && break
  sleep 2
done
kubectl --context "${CTX}" -n demo get rollout demo-canary \
  -o jsonpath='phase={.status.phase} rev={.metadata.annotations.rollout\.argoproj\.io/revision}{"\n"}'

# --- build the plugin + lay out the Headlamp runtime -------------------------
log "Building plugin"
[ -d "${REPO_ROOT}/node_modules" ] || (cd "${REPO_ROOT}" && npm install)
(cd "${REPO_ROOT}" && npm run build)

PLUGINS="${WORK}/plugins/headlamp-argo-rollouts"
mkdir -p "${PLUGINS}"
cp -r "${REPO_ROOT}/dist/main.js" "${REPO_ROOT}/dist/locales" "${REPO_ROOT}/package.json" "${PLUGINS}/"
kind get kubeconfig --name "${CLUSTER}" > "${KUBECONFIG_FILE}"
chmod -R a+rX "${WORK}"

log "Starting Headlamp (${HL_IMAGE})"
docker rm -f hl-e2e >/dev/null 2>&1 || true
docker run -d --name hl-e2e --network host \
  -v "${WORK}/plugins:/headlamp/plugins:ro,Z" \
  -v "${KUBECONFIG_FILE}:/kube/config:ro,Z" \
  --entrypoint /headlamp/headlamp-server "${HL_IMAGE}" \
  -in-cluster=false -kubeconfig /kube/config -plugins-dir /headlamp/plugins \
  -html-static-dir /headlamp/frontend -port "${HL_PORT}"

log "Waiting for Headlamp"
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "${HL_URL}/")" = "200" ] && break
  sleep 2
done

# --- capture -----------------------------------------------------------------
log "Installing Playwright"
(cd "${E2E_DIR}" && npm install)
# shellcheck disable=SC2086
(cd "${E2E_DIR}" && npx playwright install ${PW_DEPS} chromium)
log "Capturing screenshots"
(cd "${E2E_DIR}" && HL_URL="${HL_URL}" CLUSTER="${CLUSTER}" node screenshots.mjs)
log "Done"
