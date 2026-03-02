import { useState, useEffect, useCallback } from "react";
import { Navbar } from "@/components/navbar";
import { AddClusterDialog } from "@/components/add-cluster-dialog";
import { IndicesPage } from "@/components/indices-page";
import { DocumentsPage } from "@/components/documents-page";
import { useHashRoute } from "@/hooks/use-hash-route";
import {
  saveCredential,
  readCredential,
} from "@/page/use-lock-session";
import type { ClusterConfig } from "@/types/cluster";

const CLUSTERS_CREDENTIAL_ID = "cluster_configs";
const LAST_CLUSTER_KEY = "indexlens_last_cluster";

interface UnlockedShellProps {
  onLock: () => Promise<void>;
}

export function UnlockedShell({ onLock }: UnlockedShellProps) {
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const { clusterId, page, indexName, navigate, navigateCluster, navigatePage, navigateIndex } =
    useHashRoute();

  const activeCluster = clusters.find((c) => c.id === clusterId) ?? null;

  // Load clusters from encrypted vault on mount
  useEffect(() => {
    (async () => {
      const res = await readCredential(CLUSTERS_CREDENTIAL_ID);
      if (res.ok && res.data) {
        try {
          const parsed = JSON.parse(res.data) as ClusterConfig[];
          setClusters(parsed);

          // Restore last used cluster if no cluster in the hash
          if (!clusterId) {
            const lastId = localStorage.getItem(LAST_CLUSTER_KEY);
            if (lastId && parsed.some((c) => c.id === lastId)) {
              navigate(lastId, "dashboard");
            }
          }
        } catch {
          // corrupted data — start fresh
        }
      }
      setLoaded(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember the active cluster
  useEffect(() => {
    if (clusterId) {
      localStorage.setItem(LAST_CLUSTER_KEY, clusterId);
    }
  }, [clusterId]);

  // Persist clusters to encrypted vault
  const persistClusters = useCallback(async (next: ClusterConfig[]) => {
    await saveCredential(CLUSTERS_CREDENTIAL_ID, JSON.stringify(next));
  }, []);

  const handleAddCluster = async (cluster: ClusterConfig) => {
    const next = [...clusters, cluster];
    setClusters(next);
    navigate(cluster.id, "dashboard");
    await persistClusters(next);
  };

  if (!loaded) {
    return (
      <div className="flex flex-col w-full min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-screen">
      <Navbar
        clusters={clusters}
        activeCluster={activeCluster}
        activePage={page}
        onSelectCluster={(c) => navigateCluster(c.id)}
        onAddCluster={() => setAddDialogOpen(true)}
        onNavigate={navigatePage}
        onLock={onLock}
      />

      <main className="flex-1 flex flex-col">
        {!activeCluster ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <p className="text-muted-foreground">
              No cluster selected. Add one to get started.
            </p>
          </div>
        ) : page === "indices" && indexName ? (
          <DocumentsPage
            cluster={activeCluster}
            indexName={indexName}
          />
        ) : page === "indices" ? (
          <IndicesPage cluster={activeCluster} onNavigateIndex={navigateIndex} />
        ) : (
          <div className="flex-1 flex items-center justify-center p-6">
            <p className="text-muted-foreground">
              {activeCluster.name} &mdash; {page}
            </p>
          </div>
        )}
      </main>

      <AddClusterDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdd={handleAddCluster}
      />
    </div>
  );
}
