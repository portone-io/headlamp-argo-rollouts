import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import {
  AnalysisRunsListView,
  AnalysisTemplatesListView,
  ClusterAnalysisTemplatesListView,
  ExperimentsListView,
  RolloutsListView,
} from './listViews';

// A plugin-owned top-level "Argo Rollouts" sidebar section with a child per CRD
// in the family, each mounting a custom list view at /argo-rollouts/<plural>.
// This is the flux/cert-manager pattern: a dedicated section with richer,
// purpose-built list views, rather than deep-linking into the generic Custom
// Resources browser.
//
// We deliberately do NOT hide the built-in Custom Resources entries for these
// CRDs. The argoproj.io API group is shared with other Argo projects (Argo CD's
// applications, Argo Workflows' workflows, ...), so hiding the group would break
// those, and hiding only our five would leave an empty group. flux and
// cert-manager likewise coexist with the generic browser; the richer views here
// are what justify the section.
//
// Labels stay English (Kubernetes kind names; registration runs outside React).

const GROUP = 'argo-rollouts';

const ENTRIES: { name: string; label: string; component: () => JSX.Element }[] = [
  { name: 'rollouts', label: 'Rollouts', component: RolloutsListView },
  { name: 'experiments', label: 'Experiments', component: ExperimentsListView },
  { name: 'analysisruns', label: 'AnalysisRuns', component: AnalysisRunsListView },
  { name: 'analysistemplates', label: 'AnalysisTemplates', component: AnalysisTemplatesListView },
  {
    name: 'clusteranalysistemplates',
    label: 'ClusterAnalysisTemplates',
    component: ClusterAnalysisTemplatesListView,
  },
];

// Top-level section; its own link lands on the Rollouts list (the primary CRD).
registerSidebarEntry({
  parent: null,
  name: GROUP,
  label: 'Argo Rollouts',
  url: `/${GROUP}/rollouts`,
  icon: 'mdi:rocket-launch-outline',
});

for (const entry of ENTRIES) {
  const sidebarName = `${GROUP}-${entry.name}`;
  registerSidebarEntry({
    parent: GROUP,
    name: sidebarName,
    label: entry.label,
    url: `/${GROUP}/${entry.name}`,
  });
  registerRoute({
    path: `/${GROUP}/${entry.name}`,
    exact: true,
    name: entry.label,
    sidebar: sidebarName,
    component: entry.component,
  });
}
