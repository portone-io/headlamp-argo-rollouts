// Adds Strategy / Rollout status / Step / Weight columns to the Rollouts list
// (registerResourceTableColumnsProcessor on the headlamp-rollouts table).
import './RolloutColumns';
import { registerDetailsViewHeaderAction, registerMapSource } from '@kinvolk/headlamp-plugin/lib';
import { rolloutMapSource } from './mapSource';
import RollbackButton from './RollbackButton';
import RolloutActions from './RolloutActions';
import SetImageButton from './SetImageButton';

// Rollback entry point on the Rollout detail page header. The button opens a
// dialog that both lists the revision history and lets you roll back to a
// previous revision. Argo Rollouts are custom resources, and Headlamp's generic
// custom-resource detail view renders only header actions (not registered
// detail-view sections or section processors), so a header action is the only
// surface that actually renders here. The component renders nothing for
// non-Rollout resources.
registerDetailsViewHeaderAction(RollbackButton);

// Progressive-delivery actions (Promote-Full / Pause / Resume / Restart / Abort
// / Retry) as a header-action menu; each is a plain Kubernetes patch. Renders
// nothing for non-Rollout resources.
registerDetailsViewHeaderAction(RolloutActions);

// Set Image: change a container's image (new revision). Own header action with a
// small form dialog. Renders nothing for non-Rollouts / users who can't patch.
registerDetailsViewHeaderAction(SetImageButton);

// Make the Map view render Rollout -> ReplicaSet ownership like Deployment does.
registerMapSource(rolloutMapSource);
