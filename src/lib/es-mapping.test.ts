import { describe, expect, it, vi } from "vitest";
import { fetchIndexFields } from "./es-mapping";
import type { ClusterConfig } from "@/types/cluster";

// ---------------------------------------------------------------------------
// Mock esRequest so we never hit a real cluster
// ---------------------------------------------------------------------------

vi.mock("@/lib/es-client", () => ({
  esRequest: vi.fn(),
}));

import { esRequest } from "@/lib/es-client";
const mockEsRequest = vi.mocked(esRequest);

const cluster: ClusterConfig = {
  id: "test",
  name: "Test",
  url: "http://localhost:9200",
  auth: { type: "none" },
  color: "#3b82f6",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchIndexFields", () => {
  it("extracts fields from a single-index mapping response", async () => {
    mockEsRequest.mockResolvedValueOnce({
      "my-index": {
        mappings: {
          properties: {
            name: { type: "text" },
            age: { type: "integer" },
          },
        },
      },
    });

    const fields = await fetchIndexFields(cluster, "my-index");

    expect(fields).toEqual([
      { path: "age", type: "integer", isSubfield: false },
      { path: "name", type: "text", isSubfield: false },
    ]);
  });

  it("merges fields from multiple indices in a mapping response", async () => {
    mockEsRequest.mockResolvedValueOnce({
      "orders-2024": {
        mappings: {
          properties: {
            order_id: { type: "keyword" },
            amount: { type: "float" },
          },
        },
      },
      "orders-2025": {
        mappings: {
          properties: {
            order_id: { type: "keyword" },
            amount: { type: "float" },
            discount: { type: "float" },
          },
        },
      },
    });

    const fields = await fetchIndexFields(cluster, "orders-alias");

    expect(fields).toEqual([
      { path: "amount", type: "float", isSubfield: false },
      { path: "discount", type: "float", isSubfield: false },
      { path: "order_id", type: "keyword", isSubfield: false },
    ]);
  });

  it("deduplicates fields by path, keeping the first occurrence", async () => {
    mockEsRequest.mockResolvedValueOnce({
      "idx-a": {
        mappings: {
          properties: {
            status: { type: "keyword" },
          },
        },
      },
      "idx-b": {
        mappings: {
          properties: {
            // Same path but different type in a different index
            status: { type: "text" },
          },
        },
      },
    });

    const fields = await fetchIndexFields(cluster, "my-alias");

    expect(fields).toHaveLength(1);
    // First occurrence wins
    expect(fields[0]).toEqual({
      path: "status",
      type: "keyword",
      isSubfield: false,
    });
  });

  it("handles nested properties and sub-fields across indices", async () => {
    mockEsRequest.mockResolvedValueOnce({
      "logs-a": {
        mappings: {
          properties: {
            message: {
              type: "text",
              fields: { raw: { type: "keyword" } },
            },
            host: {
              properties: {
                name: { type: "keyword" },
              },
            },
          },
        },
      },
      "logs-b": {
        mappings: {
          properties: {
            message: { type: "text" },
            level: { type: "keyword" },
            host: {
              properties: {
                name: { type: "keyword" },
                ip: { type: "ip" },
              },
            },
          },
        },
      },
    });

    const fields = await fetchIndexFields(cluster, "logs-*");

    const paths = fields.map((f) => f.path);
    expect(paths).toEqual([
      "host.ip",
      "host.name",
      "level",
      "message",
      "message.raw",
    ]);

    // Verify sub-field metadata
    const rawField = fields.find((f) => f.path === "message.raw");
    expect(rawField?.isSubfield).toBe(true);
    expect(rawField?.type).toBe("keyword");
  });

  it("returns sorted results for stable autocomplete ordering", async () => {
    mockEsRequest.mockResolvedValueOnce({
      idx: {
        mappings: {
          properties: {
            zebra: { type: "keyword" },
            apple: { type: "text" },
            mango: { type: "text" },
          },
        },
      },
    });

    const fields = await fetchIndexFields(cluster, "idx");
    const paths = fields.map((f) => f.path);
    expect(paths).toEqual(["apple", "mango", "zebra"]);
  });

  it("returns empty array when response has no properties", async () => {
    mockEsRequest.mockResolvedValueOnce({
      "empty-index": {
        mappings: {},
      },
    });

    const fields = await fetchIndexFields(cluster, "empty-index");
    expect(fields).toEqual([]);
  });

  it("returns empty array for completely empty response", async () => {
    mockEsRequest.mockResolvedValueOnce({});

    const fields = await fetchIndexFields(cluster, "nonexistent");
    expect(fields).toEqual([]);
  });

  it("encodes comma-separated targets correctly in the request URL", async () => {
    mockEsRequest.mockResolvedValueOnce({
      "idx-a": {
        mappings: {
          properties: { name: { type: "text" } },
        },
      },
    });

    await fetchIndexFields(cluster, "idx-a,idx-b");

    expect(mockEsRequest).toHaveBeenCalledWith(
      cluster,
      "/idx-a,idx-b/_mapping",
      { signal: undefined },
    );
  });

  it("preserves wildcards in target encoding", async () => {
    mockEsRequest.mockResolvedValueOnce({});

    await fetchIndexFields(cluster, "logs-*");

    expect(mockEsRequest).toHaveBeenCalledWith(
      cluster,
      "/logs-*/_mapping",
      { signal: undefined },
    );
  });

  it("propagates errors from esRequest", async () => {
    mockEsRequest.mockRejectedValueOnce(new Error("Connection refused"));

    await expect(fetchIndexFields(cluster, "my-index")).rejects.toThrow(
      "Connection refused",
    );
  });
});
