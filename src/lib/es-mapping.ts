import { esRequest } from "@/lib/es-client";
import type { ClusterConfig } from "@/types/cluster";

export interface MappingField {
  path: string;
  type: string;
  isSubfield: boolean;
}

interface MappingProperty {
  type?: string;
  properties?: Record<string, MappingProperty>;
  fields?: Record<string, { type: string }>;
}

interface MappingResponse {
  [indexName: string]: {
    mappings: {
      properties?: Record<string, MappingProperty>;
    };
  };
}

function extractFields(
  properties: Record<string, MappingProperty>,
  prefix: string,
  result: MappingField[],
): void {
  for (const [name, mapping] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${name}` : name;

    if (mapping.type) {
      result.push({ path, type: mapping.type, isSubfield: false });
    }

    if (mapping.properties) {
      extractFields(mapping.properties, path, result);
    }

    if (mapping.fields) {
      for (const [subName, subMapping] of Object.entries(mapping.fields)) {
        result.push({
          path: `${path}.${subName}`,
          type: subMapping.type,
          isSubfield: true,
        });
      }
    }
  }
}

/**
 * Encode a mapping target for use in a URL path.
 *
 * Handles comma-separated target lists and wildcards by encoding each target
 * individually while preserving commas and `*` characters.
 */
function encodeMappingTarget(target: string): string {
  return target
    .split(",")
    .map((t) => encodeURIComponent(t.trim()).replace(/%2A/g, "*"))
    .join(",");
}

/**
 * Fetch mapping fields for an index, alias, or multi-target expression.
 *
 * When the target resolves to multiple indices (e.g. an alias that maps to
 * several indices, or a wildcard pattern), the fields from every index in the
 * response are merged and deduplicated by field path.  The first occurrence of
 * each path wins for metadata (`type`, `isSubfield`), and the result is sorted
 * alphabetically for stable autocomplete ordering.
 */
export async function fetchIndexFields(
  cluster: ClusterConfig,
  target: string,
  signal?: AbortSignal,
): Promise<MappingField[]> {
  const response = await esRequest<MappingResponse>(
    cluster,
    `/${encodeMappingTarget(target)}/_mapping`,
    { signal },
  );

  const fieldMap = new Map<string, MappingField>();

  for (const indexData of Object.values(response)) {
    if (!indexData?.mappings?.properties) continue;
    const indexFields: MappingField[] = [];
    extractFields(indexData.mappings.properties, "", indexFields);
    for (const field of indexFields) {
      if (!fieldMap.has(field.path)) {
        fieldMap.set(field.path, field);
      }
    }
  }

  return Array.from(fieldMap.values()).sort((a, b) =>
    a.path.localeCompare(b.path),
  );
}
