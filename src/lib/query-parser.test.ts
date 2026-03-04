import { describe, it, expect } from "vitest";
import { compileToEsQuery } from "./query-parser";
import type { MappingField } from "@/lib/es-mapping";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeField(path: string, type: string): MappingField {
  return { path, type, isSubfield: false };
}

const defaultFields: MappingField[] = [
  makeField("name", "text"),
  makeField("status", "keyword"),
  makeField("age", "long"),
  makeField("user.name", "text"),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compileToEsQuery", () => {
  it("returns match_all for empty input", () => {
    expect(compileToEsQuery("", defaultFields)).toEqual({ match_all: {} });
  });

  it("returns match_all for whitespace-only input", () => {
    expect(compileToEsQuery("   ", defaultFields)).toEqual({ match_all: {} });
  });

  // ---- Existing behaviour ---------------------------------------------------

  it("produces a match query for text fields with :", () => {
    expect(compileToEsQuery("name: john", defaultFields)).toEqual({
      match: { name: "john" },
    });
  });

  it("produces a term query for keyword fields with :", () => {
    expect(compileToEsQuery("status: active", defaultFields)).toEqual({
      term: { status: "active" },
    });
  });

  // ---- Exists queries -------------------------------------------------------

  it("produces an exists query for field: *", () => {
    expect(compileToEsQuery("fieldName: *", defaultFields)).toEqual({
      exists: { field: "fieldName" },
    });
  });

  it("produces an exists query for a keyword field with *", () => {
    expect(compileToEsQuery("status: *", defaultFields)).toEqual({
      exists: { field: "status" },
    });
  });

  it("produces an exists query for a nested field path", () => {
    expect(compileToEsQuery("user.name: *", defaultFields)).toEqual({
      exists: { field: "user.name" },
    });
  });

  // ---- NOT + exists ---------------------------------------------------------

  it("negates an exists query with NOT", () => {
    expect(compileToEsQuery("NOT fieldName: *", defaultFields)).toEqual({
      bool: { must_not: [{ exists: { field: "fieldName" } }] },
    });
  });

  // ---- Combined expressions -------------------------------------------------

  it("combines exists with AND", () => {
    expect(
      compileToEsQuery("name: * && age > 25", defaultFields),
    ).toEqual({
      bool: {
        must: [
          { exists: { field: "name" } },
          { range: { age: { gt: 25 } } },
        ],
      },
    });
  });

  it("combines exists with OR", () => {
    expect(
      compileToEsQuery("name: * || status: active", defaultFields),
    ).toEqual({
      bool: {
        should: [
          { exists: { field: "name" } },
          { term: { status: "active" } },
        ],
      },
    });
  });
});
