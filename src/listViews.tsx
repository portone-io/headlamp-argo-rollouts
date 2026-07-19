import { Link, ResourceListView, StatusLabel } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  AnalysisRun,
  AnalysisTemplate,
  ClusterAnalysisTemplate,
  Experiment,
  Rollout,
} from './customResources';
import { analysisPhaseToStatus } from './revisionsLogic';
import { rolloutStatusColumns } from './rolloutTableColumns';

// Custom list views for the Argo Rollouts CRD family, mounted by plugin routes
// under /argo-rollouts/* (see sidebar.tsx). Each is a thin ResourceListView over
// the resource class; the Name column links to Headlamp's generic custom-
// resource detail route (where this plugin's rollback / actions / set-image
// header actions render), so the family gets a richer list than the generic
// Custom Resources browser while reusing the shared detail view.
//
// Labels/titles stay English (Kubernetes kind names; see rolloutTableColumns.ts
// for the i18n rationale).

// Name column linking to the shared generic CR detail route. The built-in name
// link is broken for makeCustomResourceClass classes (detailsRoute defaults to
// the kind, which has no registered route), so link explicitly. `crd` is the
// CRD metadata.name (<plural>.<group>); namespace falls back to '-' for
// cluster-scoped resources.
function nameColumn(crd: string) {
  return {
    id: 'name',
    label: 'Name',
    getValue: (item: any) => item.metadata.name,
    render: (item: any) => (
      <Link
        routeName="customresource"
        params={{
          crd,
          namespace: item.metadata.namespace ?? '-',
          crName: item.metadata.name,
        }}
        activeCluster={item.cluster}
      >
        {item.metadata.name}
      </Link>
    ),
  };
}

// status.phase as a health-colored chip (Experiments and AnalysisRuns share the
// Argo phase vocabulary: Pending / Running / Successful / Failed / Error /
// Inconclusive).
function phaseColumn() {
  return {
    id: 'phase',
    label: 'Phase',
    getValue: (item: any) => item.jsonData?.status?.phase ?? '',
    render: (item: any) => {
      const phase = item.jsonData?.status?.phase;
      return phase ? <StatusLabel status={analysisPhaseToStatus(phase)}>{phase}</StatusLabel> : '-';
    },
  };
}

// Number of metrics defined on an AnalysisTemplate / ClusterAnalysisTemplate.
function metricsColumn() {
  return {
    id: 'metrics',
    label: 'Metrics',
    getValue: (item: any) => (item.jsonData?.spec?.metrics ?? []).length,
  };
}

export function RolloutsListView() {
  return (
    <ResourceListView
      id="argo-rollouts-rollouts"
      title="Rollouts"
      resourceClass={Rollout}
      columns={[nameColumn('rollouts.argoproj.io'), 'namespace', ...rolloutStatusColumns, 'age']}
    />
  );
}

export function ExperimentsListView() {
  return (
    <ResourceListView
      id="argo-rollouts-experiments"
      title="Experiments"
      resourceClass={Experiment}
      columns={[nameColumn('experiments.argoproj.io'), 'namespace', phaseColumn(), 'age']}
    />
  );
}

export function AnalysisRunsListView() {
  return (
    <ResourceListView
      id="argo-rollouts-analysisruns"
      title="AnalysisRuns"
      resourceClass={AnalysisRun}
      columns={[nameColumn('analysisruns.argoproj.io'), 'namespace', phaseColumn(), 'age']}
    />
  );
}

export function AnalysisTemplatesListView() {
  return (
    <ResourceListView
      id="argo-rollouts-analysistemplates"
      title="AnalysisTemplates"
      resourceClass={AnalysisTemplate}
      columns={[nameColumn('analysistemplates.argoproj.io'), 'namespace', metricsColumn(), 'age']}
    />
  );
}

export function ClusterAnalysisTemplatesListView() {
  return (
    <ResourceListView
      id="argo-rollouts-clusteranalysistemplates"
      title="ClusterAnalysisTemplates"
      resourceClass={ClusterAnalysisTemplate}
      columns={[nameColumn('clusteranalysistemplates.argoproj.io'), metricsColumn(), 'age']}
    />
  );
}
