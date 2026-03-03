import { describe, expect, it } from "vitest";
import {
  autoMethodForEndpoint,
  inferPreferredHttpMethod,
  isTerminalEndpointAction,
} from "./es-endpoint-method";

describe("inferPreferredHttpMethod", () => {
  it("infers POST for write-style actions", () => {
    expect(inferPreferredHttpMethod("/my-index/_search")).toBe("POST");
    expect(inferPreferredHttpMethod("/my-a,my-b/_delete_by_query")).toBe("POST");
    expect(inferPreferredHttpMethod("/_update_by_query")).toBe("POST");
    expect(inferPreferredHttpMethod("/_reindex")).toBe("POST");
    expect(inferPreferredHttpMethod("/_bulk")).toBe("POST");
    expect(inferPreferredHttpMethod("/_aliases")).toBe("POST");
    expect(inferPreferredHttpMethod("/_refresh")).toBe("POST");
    expect(inferPreferredHttpMethod("/_flush")).toBe("POST");
    expect(inferPreferredHttpMethod("/_forcemerge")).toBe("POST");
  });

  it("infers GET for cat and cluster read endpoints", () => {
    expect(inferPreferredHttpMethod("/_cat/indices")).toBe("GET");
    expect(inferPreferredHttpMethod("/_cat/aliases/my-alias")).toBe("GET");
    expect(inferPreferredHttpMethod("/_cat/health?v=true")).toBe("GET");
    expect(inferPreferredHttpMethod("/_cluster/health")).toBe("GET");
    expect(inferPreferredHttpMethod("/_cluster/stats?pretty=true")).toBe("GET");
    expect(inferPreferredHttpMethod("/_nodes/stats/jvm")).toBe("GET");
  });

  it("normalizes case, optional slash, and query strings", () => {
    expect(inferPreferredHttpMethod("MY-INDEX/_SeArCh?size=10")).toBe("POST");
    expect(inferPreferredHttpMethod("///_CAT/INDICES?format=json")).toBe("GET");
  });

  it("returns null for ambiguous actions", () => {
    expect(inferPreferredHttpMethod("/my-index/_doc/1")).toBeNull();
    expect(inferPreferredHttpMethod("/my-index/_mapping")).toBeNull();
    expect(inferPreferredHttpMethod("/my-index/_settings")).toBeNull();
  });

  it("returns null when no confident mapping exists", () => {
    expect(inferPreferredHttpMethod("/my-index")).toBeNull();
    expect(inferPreferredHttpMethod("/_analyze")).toBeNull();
    expect(inferPreferredHttpMethod("")).toBeNull();
    expect(inferPreferredHttpMethod("/?pretty=true")).toBeNull();
  });
});

describe("autoMethodForEndpoint", () => {
  it("falls back to GET when there is no inference", () => {
    expect(autoMethodForEndpoint("/my-index")).toBe("GET");
  });

  it("uses inferred method when available", () => {
    expect(autoMethodForEndpoint("/my-index/_search")).toBe("POST");
  });
});

describe("isTerminalEndpointAction", () => {
  it("returns true for recognized single-segment actions", () => {
    expect(isTerminalEndpointAction("/products/_search")).toBe(true);
    expect(isTerminalEndpointAction("/_aliases")).toBe(true);
    expect(isTerminalEndpointAction("/my-index/_count")).toBe(true);
  });

  it("returns true for recognized multi-segment actions", () => {
    expect(isTerminalEndpointAction("/_cat/indices")).toBe(true);
    expect(isTerminalEndpointAction("/_cluster/health?pretty=true")).toBe(true);
    expect(isTerminalEndpointAction("/_nodes/stats/jvm")).toBe(true);
  });

  it("returns false for incomplete or unknown action paths", () => {
    expect(isTerminalEndpointAction("/products/_se")).toBe(false);
    expect(isTerminalEndpointAction("/_cat")).toBe(false);
    expect(isTerminalEndpointAction("/_cluster")).toBe(false);
    expect(isTerminalEndpointAction("/my-index")).toBe(false);
    expect(isTerminalEndpointAction("")).toBe(false);
  });
});

