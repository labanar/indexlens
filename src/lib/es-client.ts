import type { AuthConfig, ClusterConfig } from "@/types/cluster";

function buildAuthHeaders(auth: AuthConfig): Record<string, string> {
  switch (auth.type) {
    case "basic":
      return {
        Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}`,
      };
    case "apikey":
      return { Authorization: `ApiKey ${auth.apiKey}` };
    case "bearer":
      return { Authorization: `Bearer ${auth.token}` };
    default:
      return {};
  }
}

export class EsRequestError extends Error {
  status: number;
  statusText: string;
  body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`ES ${status}: ${statusText}`);
    this.name = "EsRequestError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export interface EsRequestOptions {
  method?: string;
  body?: string;
  signal?: AbortSignal;
}

export async function esRequest<T>(
  cluster: ClusterConfig,
  path: string,
  options?: EsRequestOptions,
): Promise<T> {
  const url = `${cluster.url}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...buildAuthHeaders(cluster.auth),
  };

  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body,
    signal: options?.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new EsRequestError(res.status, res.statusText, body);
  }

  return res.json() as Promise<T>;
}
