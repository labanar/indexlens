import { useState, useEffect, useRef } from "react";
import { EditorView, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { foldGutter } from "@codemirror/language";
import { cmViewerTheme } from "@/lib/codemirror-theme";
import { Loader2Icon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { esRequest } from "@/lib/es-client";
import type { ClusterConfig } from "@/types/cluster";

interface IndexInfoSheetProps {
  indexName: string | null;
  cluster: ClusterConfig;
  onClose: () => void;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${regexStr}$`);
}

export function IndexInfoSheet({ indexName, cluster, onClose }: IndexInfoSheetProps) {
  const [mappings, setMappings] = useState<string | null>(null);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [mappingsError, setMappingsError] = useState<string | null>(null);

  const [template, setTemplate] = useState<string | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const [pipelines, setPipelines] = useState<string | null>(null);
  const [pipelinesLoading, setPipelinesLoading] = useState(false);
  const [pipelinesError, setPipelinesError] = useState<string | null>(null);

  useEffect(() => {
    if (!indexName) return;
    let cancelled = false;

    setMappings(null);
    setMappingsLoading(true);
    setMappingsError(null);

    (async () => {
      try {
        const res = await esRequest<Record<string, { mappings: unknown }>>(
          cluster,
          `/${encodeURIComponent(indexName)}/_mapping`,
        );
        if (cancelled) return;
        const indexMappings = res[indexName]?.mappings ?? {};
        setMappings(JSON.stringify(indexMappings, null, 2));
      } catch (err) {
        if (!cancelled) setMappingsError(err instanceof Error ? err.message : "Failed to fetch mappings");
      } finally {
        if (!cancelled) setMappingsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [indexName, cluster]);

  useEffect(() => {
    if (!indexName) return;
    let cancelled = false;

    setTemplate(null);
    setTemplateLoading(true);
    setTemplateError(null);
    setPipelines(null);
    setPipelinesLoading(true);
    setPipelinesError(null);

    (async () => {
      try {
        const settingsRes = await esRequest<Record<string, { settings: { index: Record<string, unknown> } }>>(
          cluster,
          `/${encodeURIComponent(indexName)}/_settings`,
        );
        if (cancelled) return;
        const indexSettings = settingsRes[indexName]?.settings?.index ?? {};

        // Template
        try {
          const templatesRes = await esRequest<{ index_templates: Array<{ name: string; index_template: unknown }> }>(
            cluster,
            `/_index_template`,
          );
          if (cancelled) return;

          const matched = templatesRes.index_templates?.find((t) => {
            const tpl = t.index_template as { index_patterns?: string[] };
            return tpl.index_patterns?.some((pat) => globToRegex(pat).test(indexName));
          });

          if (matched) {
            setTemplate(JSON.stringify({ name: matched.name, ...matched.index_template as object }, null, 2));
          } else {
            setTemplate(null);
          }
        } catch {
          if (!cancelled) setTemplate(null);
        } finally {
          if (!cancelled) setTemplateLoading(false);
        }

        // Pipelines
        const defaultPipeline = indexSettings.default_pipeline as string | undefined;
        const finalPipeline = indexSettings.final_pipeline as string | undefined;
        const pipelineNames = [defaultPipeline, finalPipeline].filter(
          (p): p is string => !!p && p !== "_none",
        );

        if (pipelineNames.length === 0) {
          if (!cancelled) {
            setPipelines(null);
            setPipelinesLoading(false);
          }
          return;
        }

        try {
          const pipelineResults: Record<string, unknown> = {};
          for (const name of pipelineNames) {
            const res = await esRequest<Record<string, unknown>>(
              cluster,
              `/_ingest/pipeline/${encodeURIComponent(name)}`,
            );
            if (cancelled) return;
            Object.assign(pipelineResults, res);
          }
          setPipelines(JSON.stringify(pipelineResults, null, 2));
        } catch (err) {
          if (!cancelled) setPipelinesError(err instanceof Error ? err.message : "Failed to fetch pipelines");
        } finally {
          if (!cancelled) setPipelinesLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to fetch settings";
        setTemplateError(msg);
        setTemplateLoading(false);
        setPipelinesError(msg);
        setPipelinesLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [indexName, cluster]);

  return (
    <Sheet open={indexName !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full flex flex-col p-6 sm:max-w-xl">
        <SheetHeader className="p-0">
          <SheetTitle className="font-mono text-sm truncate">{indexName}</SheetTitle>
          <SheetDescription>Index information</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="mappings" className="flex-1 flex flex-col min-h-0">
          <TabsList>
            <TabsTrigger value="mappings">Mappings</TabsTrigger>
            <TabsTrigger value="template">Template</TabsTrigger>
            <TabsTrigger value="pipelines">Pipelines</TabsTrigger>
          </TabsList>

          <TabsContent value="mappings" className="flex-1 min-h-0 flex flex-col">
            {mappingsLoading ? (
              <LoadingSpinner />
            ) : mappingsError ? (
              <ErrorMessage message={mappingsError} />
            ) : (
              <div className="flex-1 overflow-hidden rounded-md border">
                <ReadOnlyJsonViewer value={mappings ?? "{}"} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="template" className="flex-1 min-h-0 flex flex-col">
            {templateLoading ? (
              <LoadingSpinner />
            ) : templateError ? (
              <ErrorMessage message={templateError} />
            ) : template ? (
              <div className="flex-1 overflow-hidden rounded-md border">
                <ReadOnlyJsonViewer value={template} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No matching template found</p>
            )}
          </TabsContent>

          <TabsContent value="pipelines" className="flex-1 min-h-0 flex flex-col">
            {pipelinesLoading ? (
              <LoadingSpinner />
            ) : pipelinesError ? (
              <ErrorMessage message={pipelinesError} />
            ) : pipelines ? (
              <div className="flex-1 overflow-hidden rounded-md border">
                <ReadOnlyJsonViewer value={pipelines} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No ingest pipelines configured for this index</p>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
      <Loader2Icon className="size-4 animate-spin" />
      Loading...
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return <p className="text-sm text-destructive py-4">{message}</p>;
}

function ReadOnlyJsonViewer({ value }: { value: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        EditorState.readOnly.of(true),
        json(),
        cmViewerTheme,
        lineNumbers(),
        foldGutter(),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    return () => view.destroy();
  }, [value]);

  return <div ref={containerRef} className="h-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-none" />;
}
