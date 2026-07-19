import { registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';

// A plugin-owned "Argo Rollouts" sidebar section grouping the Argo Rollouts CRD
// family. Each entry links to the CRD's generic list route
// (/customresources/<plural>.argoproj.io); useClusterURL (default true) prepends
// the /c/<cluster> prefix. The Rollouts list already carries this plugin's
// custom columns, so this is a discoverability shortcut over the enriched
// generic views.
//
// Deliberately a top-level, plugin-owned section rather than a child of the
// built-in "Workloads" group: nesting there would couple to core sidebar
// internals (fragile across Headlamp versions) and imply a native-workload
// parity that a Rollout (a progressive-delivery CRD) does not have.
//
// Labels stay English: these are Kubernetes kind names, and registration runs
// outside React so the plugin's useTranslation() t is not reachable here (same
// constraint as the Rollouts list column labels).

const GROUP = 'argo-rollouts';

// The Argo Rollouts CRDs, in install order of prominence.
const RESOURCES: { name: string; label: string; plural: string }[] = [
  { name: 'rollouts', label: 'Rollouts', plural: 'rollouts' },
  { name: 'experiments', label: 'Experiments', plural: 'experiments' },
  { name: 'analysisruns', label: 'AnalysisRuns', plural: 'analysisruns' },
  { name: 'analysistemplates', label: 'AnalysisTemplates', plural: 'analysistemplates' },
  {
    name: 'clusteranalysistemplates',
    label: 'ClusterAnalysisTemplates',
    plural: 'clusteranalysistemplates',
  },
];

// Parent section. Its own link points at the Rollouts list (the primary CRD).
registerSidebarEntry({
  name: GROUP,
  label: 'Argo Rollouts',
  url: '/customresources/rollouts.argoproj.io',
  icon: 'mdi:rocket-launch-outline',
});

for (const r of RESOURCES) {
  registerSidebarEntry({
    parent: GROUP,
    name: `${GROUP}-${r.name}`,
    label: r.label,
    url: `/customresources/${r.plural}.argoproj.io`,
  });
}
