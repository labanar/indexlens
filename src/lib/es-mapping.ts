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

export async function fetchIndexFields(
  cluster: ClusterConfig,
  indexName: string,
  signal?: AbortSignal,
): Promise<MappingField[]> {
  const response = await esRequest<MappingResponse>(
    cluster,
    `/${encodeURIComponent(indexName)}/_mapping`,
    { signal },
  );

  const firstIndex = Object.values(response)[0];
  if (!firstIndex?.mappings?.properties) return [];

  const fields: MappingField[] = [];
  extractFields(firstIndex.mappings.properties, "", fields);
  return fields;
}
