import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import { projectsQueryOptions } from "@/client/features/projects/projectQueries";
import {
  deleteClusterJob,
  listClusterJobs,
} from "@/serverFunctions/keywordClustering";
import { ClusterRunForm } from "./ClusterRunForm";
import { ClusterRunView } from "./ClusterRunView";
import { DataSourceLabel } from "@/client/features/integrations/DataSourceLabel";

const STATUS_LABEL = { draft: "Not started", running: "Running", done: "Done" };

export function KeywordClusteringPage({
  projectId,
  jobId,
  onSelectJob,
}: {
  projectId: string;
  jobId: string | undefined;
  onSelectJob: (jobId: string | undefined) => void;
}) {
  const client = useQueryClient();
  const projectsQuery = useQuery(projectsQueryOptions());
  const project = projectsQuery.data?.find((p) => p.id === projectId);
  const jobsQuery = useQuery({
    queryKey: ["clusterJobs", projectId],
    queryFn: () => listClusterJobs({ data: { projectId } }),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      deleteClusterJob({ data: { projectId, jobId: id } }),
    onSuccess: (_, id) => {
      if (id === jobId) onSelectJob(undefined);
      void client.invalidateQueries({ queryKey: ["clusterJobs", projectId] });
    },
  });
  const jobs = jobsQuery.data ?? [];

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          title="Keyword Clustering"
          description="Group keywords by shared Google top-10 results, then map each cluster to one page."
          actions={
            jobId ? (
              <Button variant="outline" onClick={() => onSelectJob(undefined)}>
                New run
              </Button>
            ) : (
              <DataSourceLabel projectId={projectId} prefix="New runs use" />
            )
          }
        />
        {jobId ? (
          <ClusterRunView
            key={jobId}
            projectId={projectId}
            jobId={jobId}
            ownDomain={project?.domain ?? null}
          />
        ) : (
          <ClusterRunForm
            projectId={projectId}
            onCreated={(id) => {
              void client.invalidateQueries({
                queryKey: ["clusterJobs", projectId],
              });
              onSelectJob(id);
            }}
          />
        )}
        {jobs.length ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Previous runs</h2>
            <ul className="divide-y rounded-xl border bg-card text-sm">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3"
                >
                  <button
                    type="button"
                    className="text-left underline-offset-2 hover:underline"
                    onClick={() => onSelectJob(job.id)}
                  >
                    <span className="font-medium">{job.name}</span>{" "}
                    <span className="text-muted-foreground">
                      · {job.total.toLocaleString()} keywords ·{" "}
                      {STATUS_LABEL[job.status]} ·{" "}
                      {new Date(job.createdAt).toLocaleDateString()}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={remove.isPending || job.status === "running"}
                    onClick={() => {
                      if (window.confirm(`Delete "${job.name}"?`))
                        remove.mutate(job.id);
                    }}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
