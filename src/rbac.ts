import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { useEffect, useState } from 'react';

// Whether the current user may `patch` this Rollout, via a SelfSubjectAccessReview
// (the same check kubectl uses). Returns:
//   undefined -> still checking (treat as "show", optimistic)
//   true/false -> the SSAR result
// Mutating action buttons hide themselves when this is `false`, so a read-only
// user isn't offered controls that would 403. (Abort/Retry/Promote also touch
// rollouts/status, but patch on rollouts is the practical gate; a failed call
// still surfaces its error.)
export function useCanPatchRollout(namespace: string, name: string): boolean | undefined {
  const [allowed, setAllowed] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!namespace || !name) {
      return;
    }
    request('/apis/authorization.k8s.io/v1/selfsubjectaccessreviews', {
      method: 'POST',
      body: JSON.stringify({
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'SelfSubjectAccessReview',
        spec: {
          resourceAttributes: {
            group: 'argoproj.io',
            resource: 'rollouts',
            verb: 'patch',
            namespace,
            name,
          },
        },
      }),
      headers: { 'Content-Type': 'application/json' },
    })
      .then(res => {
        if (!cancelled) {
          setAllowed(res?.status?.allowed === true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllowed(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [namespace, name]);

  return allowed;
}
