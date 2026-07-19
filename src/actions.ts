// Pure (SDK-free) logic for the Argo Rollout progressive-delivery actions:
// the exact patch bodies and the applicability gating. Kept free of any
// `@kinvolk/headlamp-plugin` import so it is unit-testable without booting the
// SDK. The `request`-based apply lives in ./actionsApi.
//
// The patches mirror the `kubectl argo rollouts` commands
// (pkg/kubectl-argo-rollouts/cmd/*). The precise `promote` (advance one canary
// step) is intentionally not here yet — it needs promote.go's step-index
// derivation and is tracked separately. `promoteFull` is included as it is a
// single unambiguous flag.

export type RolloutActionId =
  | 'promote'
  | 'promoteFull'
  | 'abort'
  | 'retry'
  | 'restart'
  | 'pause'
  | 'resume';

export interface RolloutActionResult {
  success: boolean;
  message: string;
}

export const ACTION_LABEL: Record<RolloutActionId, string> = {
  promote: 'Promote',
  promoteFull: 'Promote Full',
  abort: 'Abort',
  retry: 'Retry',
  restart: 'Restart',
  pause: 'Pause',
  resume: 'Resume',
};

// ---------------------------------------------------------------------------
// Pure patch builders. Each returns the JSON body for a merge-patch;
// `restartBody` takes an injected clock so it is deterministic.
// ---------------------------------------------------------------------------

export function abortBody() {
  return { status: { abort: true } };
}

export function retryBody() {
  return { status: { abort: false } };
}

export function promoteFullBody() {
  return { status: { promoteFull: true } };
}

// Plain promote (advance one canary step). Clearing the pause condition alone is
// NOT enough: on an indefinite `pause: {}` step the controller just re-adds the
// pause at the same index. So we also bump `currentStepIndex` past the current
// step (verified against a live controller). `pauseConditions: null` clears the
// pause (null removes the field in a merge-patch). For blueGreen / no canary
// steps there is no step index to advance, so it is omitted.
export function promoteBody(nextStepIndex?: number) {
  const status: { pauseConditions: null; currentStepIndex?: number } = {
    pauseConditions: null,
  };
  if (nextStepIndex !== undefined) {
    status.currentStepIndex = nextStepIndex;
  }
  return { status };
}

// The step index a plain promote should jump to: one past the current canary
// step, capped at the total. Returns undefined when there are no canary steps
// (blueGreen), where only the pause is cleared.
export function promoteNextStepIndex(rollout: any): number | undefined {
  const { spec, status } = raw(rollout);
  const steps = spec.strategy?.canary?.steps ?? [];
  if (steps.length === 0) {
    return undefined;
  }
  const current = status.currentStepIndex ?? 0;
  return Math.min(current + 1, steps.length);
}

export function pauseBody() {
  return { spec: { paused: true } };
}

export function resumeBody() {
  return { spec: { paused: false } };
}

export function restartBody(now: Date) {
  return { spec: { restartAt: now.toISOString() } };
}

// Set Image: a targeted JSON Patch replacing one container's image (applied with
// content-type application/json-patch+json). Scoped to a single container index
// so it never rewrites the rest of the pod template.
export function setImagePatch(containerIndex: number, image: string) {
  return [
    {
      op: 'replace',
      path: `/spec/template/spec/containers/${containerIndex}/image`,
      value: image,
    },
  ];
}

// ---------------------------------------------------------------------------
// Applicability gating. Reads the raw Rollout (spec + status) so buttons are
// only offered when the action is meaningful.
// ---------------------------------------------------------------------------

function raw(rollout: any): { spec: any; status: any } {
  const obj = rollout?.jsonData ?? rollout ?? {};
  return { spec: obj.spec ?? {}, status: obj.status ?? {} };
}

function isPaused(rollout: any): boolean {
  const { spec, status } = raw(rollout);
  return (
    spec.paused === true ||
    (Array.isArray(status.pauseConditions) && status.pauseConditions.length > 0)
  );
}

function isAborted(rollout: any): boolean {
  return raw(rollout).status.abort === true;
}

function phase(rollout: any): string {
  return raw(rollout).status.phase ?? '';
}

export function isApplicable(id: RolloutActionId, rollout: any): boolean {
  const { spec } = raw(rollout);
  switch (id) {
    case 'pause':
      return spec.paused !== true;
    case 'resume':
      return spec.paused === true;
    case 'retry':
      return isAborted(rollout);
    case 'abort':
      // Meaningful while the rollout is not already aborted and is still in
      // flight (paused, progressing, or degraded) rather than settled Healthy.
      return (
        !isAborted(rollout) &&
        (isPaused(rollout) || phase(rollout) === 'Progressing' || phase(rollout) === 'Degraded')
      );
    case 'promote':
    case 'promoteFull':
      return isPaused(rollout) || phase(rollout) === 'Progressing';
    case 'restart':
      return true;
    default:
      return false;
  }
}
