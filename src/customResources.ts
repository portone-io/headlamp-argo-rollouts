import { makeCustomResourceClass } from '@kinvolk/headlamp-plugin/lib/Crd';

// The Argo Rollouts CRD family as Headlamp resource classes, so the custom list
// views (listViews.tsx) can list them with .useList() and the namespace filter.
// All are argoproj.io/v1alpha1; ClusterAnalysisTemplate is cluster-scoped.
const GROUP = 'argoproj.io';
const VERSION = 'v1alpha1';

function cr(kind: string, pluralName: string, singularName: string, isNamespaced: boolean) {
  return makeCustomResourceClass({
    apiInfo: [{ group: GROUP, version: VERSION }],
    kind,
    pluralName,
    singularName,
    isNamespaced,
  });
}

export const Rollout = cr('Rollout', 'rollouts', 'rollout', true);
export const Experiment = cr('Experiment', 'experiments', 'experiment', true);
export const AnalysisRun = cr('AnalysisRun', 'analysisruns', 'analysisrun', true);
export const AnalysisTemplate = cr('AnalysisTemplate', 'analysistemplates', 'analysistemplate', true);
export const ClusterAnalysisTemplate = cr(
  'ClusterAnalysisTemplate',
  'clusteranalysistemplates',
  'clusteranalysistemplate',
  false
);
