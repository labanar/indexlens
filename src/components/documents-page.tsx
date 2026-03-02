import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns3Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { esRequest, EsRequestError } from "@/lib/es-client";
import { fetchIndexFields } from "@/lib/es-mapping";
import { useDebounce } from "@/hooks/use-debounce";
import { compileToEsQuery, ParseError } from "@/lib/query-parser";
import { QueryEditor } from "@/components/query-editor";
import { IndexPatternEditor } from "@/components/index-pattern-editor";
import type { IndexTarget } from "@/components/index-pattern-editor";
import { DocumentViewerSheet } from "@/components/document-viewer-sheet";
import type { MappingField } from "@/lib/es-mapping";
import type { ClusterConfig } from "@/types/cluster";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchHit {
  _id: string;
  _source: Record<string, unknown>;
}

interface SearchResponse {
  hits: {
    total: { value: number; relation: string };
    hits: SearchHit[];
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50];
const numFmt = new Intl.NumberFormat();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeIndexPattern(pattern: string): string {
  return pattern
    .split(",")
    .map((p) => encodeURIComponent(p.trim()).replace(/%2A/g, "*"))
    .join(",");
}

function renderCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DocumentsPageProps {
  cluster: ClusterConfig;
  indexName: string;
}

export function DocumentsPage({
  cluster,
  indexName,
}: DocumentsPageProps) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [columns, setColumns] = useState<string[]>([]);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [fields, setFields] = useState<MappingField[]>([]);
  const [activeQuery, setActiveQuery] = useState<object>({ match_all: {} });
  const [queryError, setQueryError] = useState<string | null>(null);
  const [selectedHit, setSelectedHit] = useState<SearchHit | null>(null);
  const [indexPattern, setIndexPattern] = useState(indexName);
  const [activeTarget, setActiveTarget] = useState(indexName);
  const [patternMatchCount, setPatternMatchCount] = useState<number | null>(null);
  const debouncedPattern = useDebounce(indexPattern, 300);
  const [indexTargets, setIndexTargets] = useState<IndexTarget[]>([]);
  const queryTextRef = useRef("");

  // Fetch mapping fields for autocomplete + query compilation
  useEffect(() => {
    const controller = new AbortController();
    fetchIndexFields(cluster, indexName, controller.signal)
      .then(setFields)
      .catch(() => {});
    return () => controller.abort();
  }, [cluster, indexName]);

  // Fetch all index names + aliases for autocomplete
  useEffect(() => {
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    Promise.all([
      esRequest<Array<{ index: string }>>(
        cluster,
        "/_cat/indices?format=json&h=index&s=index&expand_wildcards=all",
        opts,
      ).catch(() => [] as Array<{ index: string }>),
      esRequest<Array<{ alias: string }>>(
        cluster,
        "/_cat/aliases?format=json&h=alias",
        opts,
      ).catch(() => [] as Array<{ alias: string }>),
    ]).then(([indices, aliases]) => {
      const indexNames = new Set(indices.map((r) => r.index));
      const targets: IndexTarget[] = indices.map((r) => ({
        name: r.index,
        kind: "index",
      }));
      const seen = new Set<string>();
      for (const a of aliases) {
        if (!indexNames.has(a.alias) && !seen.has(a.alias)) {
          seen.add(a.alias);
          targets.push({ name: a.alias, kind: "alias" });
        }
      }
      targets.sort((a, b) => a.name.localeCompare(b.name));
      setIndexTargets(targets);
    });
    return () => controller.abort();
  }, [cluster]);

  // Count indices matching the pattern (debounced)
  useEffect(() => {
    const trimmed = debouncedPattern.trim();
    if (!trimmed) {
      setPatternMatchCount(null);
      return;
    }
    // If pattern is exactly the indexName, skip the count
    if (trimmed === indexName) {
      setPatternMatchCount(null);
      return;
    }
    const controller = new AbortController();
    esRequest<Array<{ index: string }>>(
      cluster,
      `/_cat/indices/${encodeIndexPattern(trimmed)}?format=json&h=index&expand_wildcards=all`,
      { signal: controller.signal },
    )
      .then((result) => setPatternMatchCount(result.length))
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof EsRequestError && err.status === 404) {
          setPatternMatchCount(0);
        } else {
          setPatternMatchCount(null);
        }
      });
    return () => controller.abort();
  }, [cluster, debouncedPattern, indexName]);

  const handleExecuteQuery = useCallback(
    (text: string) => {
      try {
        const query = compileToEsQuery(text, fields);
        setActiveQuery(query);
        setQueryError(null);
        setPage(0);
      } catch (e) {
        if (e instanceof ParseError) {
          setQueryError(e.message);
        } else {
          setQueryError("Invalid query");
        }
        return;
      }
      setActiveTarget(indexPattern.trim() || indexName);
    },
    [fields, indexPattern, indexName],
  );

  const fetchDocuments = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const from = page * pageSize;
        const result = await esRequest<SearchResponse>(
          cluster,
          `/${encodeIndexPattern(activeTarget)}/_search`,
          {
            method: "POST",
            body: JSON.stringify({
              from,
              size: pageSize,
              query: activeQuery,
            }),
            signal,
          },
        );

        if (signal.aborted) return;

        setHits(result.hits.hits);
        setTotal(result.hits.total.value);

        // Derive columns from _source fields
        const fieldSet = new Set<string>();
        for (const hit of result.hits.hits) {
          if (hit._source) {
            for (const key of Object.keys(hit._source)) {
              fieldSet.add(key);
            }
          }
        }
        setColumns(Array.from(fieldSet).sort());
      } catch (err) {
        if (signal.aborted) return;
        setError(
          err instanceof Error ? err.message : "Failed to fetch documents",
        );
        setHits([]);
        setTotal(0);
        setColumns([]);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [cluster, activeTarget, page, pageSize, activeQuery],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchDocuments(controller.signal);
    return () => controller.abort();
  }, [fetchDocuments]);

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenColumns.has(c)),
    [columns, hiddenColumns],
  );

  const toggleColumn = useCallback((col: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) {
        next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const rangeStart = total === 0 ? 0 : safePage * pageSize + 1;
  const rangeEnd = Math.min((safePage + 1) * pageSize, total);
  const colCount = visibleColumns.length + 1;

  return (
    <div className="flex flex-col gap-4 p-6 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold font-mono">{indexName}</h2>
          {!loading && !error && (
            <p className="text-sm text-muted-foreground">
              {numFmt.format(total)} documents
            </p>
          )}
        </div>

        {columns.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3Icon className="size-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col}
                  checked={!hiddenColumns.has(col)}
                  onCheckedChange={() => toggleColumn(col)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {col}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Query + Index Pattern */}
      <div className="flex gap-3 mb-1">
        <div className="flex flex-col gap-1 w-3/5">
          <label className="text-xs text-muted-foreground">Query</label>
          <QueryEditor
            fields={fields}
            onExecute={handleExecuteQuery}
            onChange={(v) => { queryTextRef.current = v; }}
          />
          <p className="text-xs text-destructive h-4">
            {queryError ?? "\u00A0"}
          </p>
        </div>
        <div className="flex flex-col gap-1 w-2/5">
          <label className="text-xs text-muted-foreground">Index pattern</label>
          <IndexPatternEditor
            targets={indexTargets}
            defaultValue={indexName}
            placeholder={`${indexName}, ${indexName}-*`}
            onExecute={() => handleExecuteQuery(queryTextRef.current)}
            onChange={setIndexPattern}
          />
          <p className="text-xs text-muted-foreground h-4">
            {patternMatchCount !== null
              ? patternMatchCount === 0
                ? "No matching indices"
                : `${patternMatchCount} matching ${patternMatchCount === 1 ? "index" : "indices"}`
              : "\u00A0"}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">_id</TableHead>
              {visibleColumns.map((col) => (
                <TableHead key={col} className="min-w-[150px]">
                  {col}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <SkeletonRows cols={colCount > 1 ? colCount : 5} rows={pageSize} />
            ) : error ? (
              <TableRow>
                <TableCell
                  colSpan={colCount}
                  className="h-24 text-center text-destructive"
                >
                  {error}
                </TableCell>
              </TableRow>
            ) : hits.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colCount}
                  className="h-24 text-center text-muted-foreground"
                >
                  No documents found
                </TableCell>
              </TableRow>
            ) : (
              hits.map((hit) => (
                <TableRow
                  key={hit._id}
                  className="cursor-pointer"
                  onClick={() => setSelectedHit(hit)}
                >
                  <TableCell className="font-mono text-xs">
                    {hit._id}
                  </TableCell>
                  {visibleColumns.map((col) => (
                    <TableCell
                      key={col}
                      className="text-sm max-w-[300px] truncate"
                    >
                      {renderCellValue(hit._source?.[col])}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground tabular-nums">
            {rangeStart}&ndash;{rangeEnd} of {numFmt.format(total)} documents
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground whitespace-nowrap">
                Rows
              </span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(0);
                }}
              >
                <SelectTrigger size="sm" className="w-[70px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeftIcon className="size-4" />
                Previous
              </Button>
              <div className="flex items-center gap-1 px-1">
                <input
                  type="text"
                  inputMode="numeric"
                  className="w-10 text-center text-sm tabular-nums bg-transparent border rounded px-1 py-0.5 border-input focus:outline-none focus:border-ring"
                  value={safePage + 1}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n)) setPage(Math.max(0, Math.min(n - 1, totalPages - 1)));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
                <span className="text-muted-foreground tabular-nums">/ {totalPages}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      <DocumentViewerSheet
        hit={selectedHit}
        onClose={() => setSelectedHit(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loading rows
// ---------------------------------------------------------------------------

function SkeletonRows({ cols, rows = 8 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }, (_, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-24" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
