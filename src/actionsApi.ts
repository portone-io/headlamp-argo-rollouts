import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import {
  abortBody,
  ACTION_LABEL,
  pauseBody,
  promoteFullBody,
  restartBody,
  resumeBody,
  retryBody,
  RolloutActionId,
  RolloutActionResult,
} from './actions';

const GROUP = 'argoproj.io';
const VERSION = 'v1alpha1';

function rolloutPath(namespace: string, name: string, sub = ''): string {
  return `/apis/${GROUP}/${VERSION}/namespaces/${namespace}/rollouts/${name}${sub}`;
}

async function mergePatch(path: string, body: unknown): Promise<void> {
  await request(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/merge-patch+json' },
  });
}

// Abort / Retry / Promote-Full write the `status` subresource on modern
// clusters. Older CRDs don't serve /status; fall back to patching the main
// resource with the same body.
async function statusPatch(namespace: string, name: string, body: unknown): Promise<void> {
  try {
    await mergePatch(rolloutPath(namespace, name, '/status'), body);
  } catch {
    await mergePatch(rolloutPath(namespace, name), body);
  }
}

export async function applyAction(
  id: RolloutActionId,
  namespace: string,
  name: string
): Promise<RolloutActionResult> {
  try {
    switch (id) {
      case 'pause':
        await mergePatch(rolloutPath(namespace, name), pauseBody());
        break;
      case 'resume':
        await mergePatch(rolloutPath(namespace, name), resumeBody());
        break;
      case 'restart':
        await mergePatch(rolloutPath(namespace, name), restartBody(new Date()));
        break;
      case 'abort':
        await statusPatch(namespace, name, abortBody());
        break;
      case 'retry':
        await statusPatch(namespace, name, retryBody());
        break;
      case 'promoteFull':
        await statusPatch(namespace, name, promoteFullBody());
        break;
      default:
        return { success: false, message: `Unknown action: ${id}` };
    }
    return { success: true, message: `${ACTION_LABEL[id]} succeeded` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `${ACTION_LABEL[id]} failed: ${msg}` };
  }
}
