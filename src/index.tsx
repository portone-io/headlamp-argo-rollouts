import { registerDetailsViewHeaderAction, registerMapSource } from '@kinvolk/headlamp-plugin/lib';
import { rolloutMapSource } from './mapSource';
import RollbackButton from './RollbackButton';

// Rollback entry point on the Rollout detail page header. The button opens a
// dialog that both lists the revision history and lets you roll back to a
// previous revision. Argo Rollouts are custom resources, and Headlamp's generic
// custom-resource detail view renders only header actions (not registered
// detail-view sections or section processors), so a header action is the only
// surface that actually renders here. The component renders nothing for
// non-Rollout resources.
registerDetailsViewHeaderAction(RollbackButton);

// Make the Map view render Rollout -> ReplicaSet ownership like Deployment does.
registerMapSource(rolloutMapSource);
