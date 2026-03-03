import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { EditorView, keymap, lineNumbers, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter, lintGutter } from "@codemirror/lint";
import { foldGutter } from "@codemirror/language";
import {
  autocompletion,
  acceptCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult, Completion } from "@codemirror/autocomplete";
import { history, historyKeymap } from "@codemirror/commands";
import { PlayIcon, CopyIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cmTheme, cmViewerTheme } from "@/lib/codemirror-theme";
import { esRequest } from "@/lib/es-client";
import { fetchIndexFields } from "@/lib/es-mapping";
import { esDslCompletions } from "@/lib/es-query-completions";
import { useDebounce } from "@/hooks/use-debounce";
import type { MappingField } from "@/lib/es-mapping";
import type { ClusterConfig } from "@/types/cluster";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "HEAD"] as const;

const ES_OPERATIONS: Completion[] = [
  "_search",
  "_count",
  "_mapping",
  "_settings",
  "_doc",
  "_bulk",
  "_delete_by_query",
  "_update_by_query",
  "_analyze",
  "_refresh",
  "_flush",
  "_forcemerge",
  "_reindex",
  "_aliases",
  "_cat/indices",
  "_cat/aliases",
  "_cat/health",
  "_cat/nodes",
  "_cat/shards",
  "_cluster/health",
  "_cluster/stats",
  "_nodes/stats",
].map((op) => ({
  label: op,
  type: "keyword",
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract index name from a path like "/my-index/_search" → "my-index" */
function extractIndexFromPath(path: string): string | null {
  const trimmed = path.replace(/^\/+/, "");
  if (!trimmed) return null;
  const first = trimmed.split("/")[0];
  if (!first || first.startsWith("_")) return null;
  return decodeURIComponent(first);
}

function buildEndpointCompletions(indexNames: string[]) {
  const indexOptions: Completion[] = indexNames.map((name) => ({
    label: name,
    type: "variable",
  }));

  return (context: CompletionContext): CompletionResult | null => {
    const doc = context.state.doc.toString();

    // Find the current segment: text after the last /
    const lastSlash = doc.lastIndexOf("/", context.pos - 1);
    const segmentStart = lastSlash + 1;
    const segment = doc.slice(segmentStart, context.pos);

    if (segment.length === 0 && !context.explicit) return null;

    // If we're at the first segment (no slash or only leading slash), suggest indices
    // If we're after an index name, suggest operations
    const beforeSlash = doc.slice(0, Math.max(0, lastSlash)).replace(/^\/+/, "");
    const isFirstSegment = !beforeSlash;

    const options = isFirstSegment
      ? [...indexOptions, ...ES_OPERATIONS]
      : ES_OPERATIONS;

    return {
      from: segmentStart,
      options,
      filter: true,
    };
  };
}

// ---------------------------------------------------------------------------
// Raw ES fetch (returns status + body text instead of throwing)
// ---------------------------------------------------------------------------

interface RawEsResponse {
  status: number;
  statusText: string;
  body: string;
  elapsed: number;
}

async function rawEsRequest(
  cluster: ClusterConfig,
  method: string,
  path: string,
  body: string | undefined,
  signal?: AbortSignal,
): Promise<RawEsResponse> {
  const url = `${cluster.url}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  // Build auth headers inline (same logic as esRequest)
  const auth = cluster.auth;
  if (auth.type === "basic") {
    headers.Authorization = `Basic ${btoa(`${auth.username}:${auth.password}`)}`;
  } else if (auth.type === "apikey") {
    headers.Authorization = `ApiKey ${auth.apiKey}`;
  } else if (auth.type === "bearer") {
    headers.Authorization = `Bearer ${auth.token}`;
  }

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const t0 = performance.now();
  const res = await fetch(url, {
    method,
    headers,
    body: body || undefined,
    signal,
  });
  const elapsed = performance.now() - t0;
  const text = await res.text();

  return {
    status: res.status,
    statusText: res.statusText,
    body: text,
    elapsed,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RestPageProps {
  cluster: ClusterConfig;
}

export function RestPage({ cluster }: RestPageProps) {
  const [method, setMethod] = useState<string>("GET");
  const [endpoint, setEndpoint] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<RawEsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [indexNames, setIndexNames] = useState<string[]>([]);
  const [fields, setFields] = useState<MappingField[]>([]);
  const [copied, setCopied] = useState(false);

  const supportsBody = method === "POST" || method === "PUT";
  const bodyRef = useRef("");
  const endpointRef = useRef("");
  const debouncedEndpoint = useDebounce(endpoint, 400);

  // Fetch index names + aliases for endpoint autocomplete
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      esRequest<Array<{ index: string }>>(
        cluster,
        "/_cat/indices?format=json&h=index&s=index&expand_wildcards=all",
        { signal: controller.signal },
      ).catch(() => [] as Array<{ index: string }>),
      esRequest<Array<{ alias: string }>>(
        cluster,
        "/_cat/aliases?format=json&h=alias",
        { signal: controller.signal },
      ).catch(() => [] as Array<{ alias: string }>),
    ]).then(([indices, aliases]) => {
      const names = new Set(indices.map((r) => r.index));
      for (const a of aliases) names.add(a.alias);
      setIndexNames(Array.from(names).sort());
    });
    return () => controller.abort();
  }, [cluster]);

  // Fetch mapping fields when the endpoint targets a specific index
  useEffect(() => {
    const indexName = extractIndexFromPath(debouncedEndpoint);
    if (!indexName) {
      setFields([]);
      return;
    }

    const controller = new AbortController();
    fetchIndexFields(cluster, indexName, controller.signal)
      .then(setFields)
      .catch(() => setFields([]));
    return () => controller.abort();
  }, [cluster, debouncedEndpoint]);

  const handleSend = useCallback(async () => {
    const path = endpointRef.current.trim();
    if (!path) return;

    setLoading(true);
    setError(null);

    try {
      const result = await rawEsRequest(
        cluster,
        method,
        path,
        supportsBody ? bodyRef.current.trim() || undefined : undefined,
      );

      // Try to pretty-print JSON response
      try {
        const parsed = JSON.parse(result.body);
        result.body = JSON.stringify(parsed, null, 2);
      } catch {
        // Not JSON — keep raw text
      }

      setResponse(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Request failed");
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }, [cluster, method, supportsBody]);

  const handleCopy = async () => {
    if (!response) return;
    await navigator.clipboard.writeText(response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const responseText = useMemo(() => {
    if (loading) return "Loading...";
    if (error) return error;
    if (response) return response.body;
    return "";
  }, [loading, error, response]);

  return (
    <div className="flex flex-1 gap-0 h-full">
      {/* Left panel — Request */}
      <div className="flex-1 flex flex-col p-6 gap-3 border-r min-w-0">
        {/* Method + Endpoint */}
        <div className="flex gap-2 items-center">
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="w-[110px] font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((m) => (
                <SelectItem key={m} value={m} className="font-mono">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex-1">
            <EndpointEditor
              indexNames={indexNames}
              onChange={(v) => {
                endpointRef.current = v;
                setEndpoint(v);
              }}
              onExecute={handleSend}
            />
          </div>
          <Button onClick={handleSend} disabled={loading} size="sm">
            <PlayIcon className="size-4" />
            Send
          </Button>
        </div>

        {/* Body editor */}
        <div className="flex-1 overflow-hidden rounded-md border min-h-0 relative">
          {supportsBody ? (
            <BodyEditor
              fields={fields}
              endpoint={debouncedEndpoint}
              onSend={handleSend}
              onChange={(v) => { bodyRef.current = v; }}
            />
          ) : (
            <div className="h-full flex items-center justify-center bg-[#282a36]">
              <p className="text-sm text-muted-foreground">
                Body is not supported for {method} requests
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Right panel — Response */}
      <div className="flex-1 flex flex-col p-6 gap-3 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Response</span>
            {response && (
              <>
                <StatusBadge status={response.status} text={response.statusText} />
                <span className="text-muted-foreground tabular-nums">
                  {Math.round(response.elapsed)}ms
                </span>
              </>
            )}
          </div>
          {response && (
            <Button variant="ghost" size="sm" onClick={handleCopy}>
              {copied ? (
                <CheckIcon className="size-4 text-green-500" />
              ) : (
                <CopyIcon className="size-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-hidden rounded-md border min-h-0">
          <ResponseViewer value={responseText} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status, text }: { status: number; text: string }) {
  const color =
    status < 300
      ? "text-green-500"
      : status < 400
        ? "text-yellow-500"
        : "text-red-500";

  return (
    <span className={`font-mono font-semibold tabular-nums ${color}`}>
      {status} {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Endpoint editor (single-line with autocomplete)
// ---------------------------------------------------------------------------

function EndpointEditor({
  indexNames,
  onChange,
  onExecute,
}: {
  indexNames: string[];
  onChange: (value: string) => void;
  onExecute: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onExecuteRef = useRef(onExecute);
  onExecuteRef.current = onExecute;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const existingDoc = viewRef.current?.state.doc.toString();

    const state = EditorState.create({
      doc: existingDoc ?? "",
      extensions: [
        history(),
        keymap.of(historyKeymap),
        cmTheme,
        autocompletion({
          override: [buildEndpointCompletions(indexNames)],
          activateOnTyping: true,
        }),
        keymap.of([
          {
            key: "Tab",
            run: (view) => {
              if (acceptCompletion(view)) return true;
              startCompletion(view);
              return true;
            },
          },
          {
            key: "Enter",
            run: () => {
              onExecuteRef.current();
              return true;
            },
          },
        ]),
        cmPlaceholder("/my-index/_search"),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.lineWrapping,
        EditorState.transactionFilter.of((tr) => {
          if (tr.newDoc.lines > 1) return [];
          return tr;
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [indexNames]);

  return (
    <div
      ref={containerRef}
      className="rounded-md border overflow-hidden [&_.cm-editor]:outline-none"
    />
  );
}

// ---------------------------------------------------------------------------
// Body editor (multi-line JSON with field autocomplete)
// ---------------------------------------------------------------------------

function BodyEditor({
  fields,
  endpoint,
  onSend,
  onChange,
}: {
  fields: MappingField[];
  endpoint: string;
  onSend: () => void;
  onChange: (value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const existingDoc = viewRef.current?.state.doc.toString();

    const state = EditorState.create({
      doc: existingDoc ?? "{\n  \n}",
      extensions: [
        history(),
        keymap.of(historyKeymap),
        json(),
        linter(jsonParseLinter()),
        lintGutter(),
        cmViewerTheme,
        lineNumbers(),
        foldGutter(),
        autocompletion({
          override: [esDslCompletions(fields, endpoint)],
          activateOnTyping: true,
        }),
        keymap.of([
          {
            key: "Tab",
            run: (view) => {
              if (acceptCompletion(view)) return true;
              startCompletion(view);
              return true;
            },
          },
          {
            key: "Ctrl-Enter",
            run: () => {
              onSendRef.current();
              return true;
            },
          },
          {
            key: "Mod-Enter",
            run: () => {
              onSendRef.current();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [fields, endpoint]);

  return (
    <div
      ref={containerRef}
      className="h-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-none"
    />
  );
}

// ---------------------------------------------------------------------------
// Response viewer (read-only)
// ---------------------------------------------------------------------------

function ResponseViewer({ value }: { value: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

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
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="h-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-none"
    />
  );
}
