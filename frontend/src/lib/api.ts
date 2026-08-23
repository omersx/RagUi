import { useConfigStore } from "@/stores/configStore";
import type {
  ChatConfigPayload,
  FileRecord,
  HealthStatus,
  IngestResult,
  KnowledgeStats,
  SessionSummary,
  SSEEvent,
  StoredMessage,
} from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

function url(path: string): string {
  return `${API_BASE}${path}`;
}

/** Bearer token for deployments that set API_AUTH_TOKEN on the backend. */
function authHeaders(): Record<string, string> {
  const token = useConfigStore.getState().authToken.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? body.message ?? JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ---------- System ----------

export async function getHealth(): Promise<HealthStatus> {
  return json(await fetch(url("/api/health"), { cache: "no-store" }));
}

export async function testApiKey(
  apiKey: string,
  baseUrl = ""
): Promise<{ valid: boolean; message: string }> {
  return json(
    await fetch(url("/api/test-key"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ provider: "api", api_key: apiKey, base_url: baseUrl }),
    })
  );
}

// ---------- Knowledge ----------

export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  return json(await fetch(url("/api/knowledge/stats"), { cache: "no-store", headers: authHeaders() }));
}

export async function getKnowledgeFiles(): Promise<FileRecord[]> {
  return json(await fetch(url("/api/knowledge/files"), { cache: "no-store", headers: authHeaders() }));
}

export async function deleteKnowledgeFile(fileId: number): Promise<{ chunks_removed: number }> {
  return json(await fetch(url(`/api/knowledge/files/${fileId}`), { method: "DELETE", headers: authHeaders() }));
}

// ---------- Sessions ----------

export async function getSessions(): Promise<SessionSummary[]> {
  return json(await fetch(url("/api/sessions"), { cache: "no-store", headers: authHeaders() }));
}

export async function getSessionMessages(sessionId: string): Promise<StoredMessage[]> {
  return json(
    await fetch(url(`/api/sessions/${sessionId}/messages`), { cache: "no-store", headers: authHeaders() })
  );
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(url(`/api/sessions/${sessionId}`), { method: "DELETE", headers: authHeaders() });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete session (${res.status})`);
  }
}

// ---------- Upload (XHR for real progress) ----------

export interface UploadOptions {
  file: File;
  config: ChatConfigPayload;
  ocrEnabled: boolean;
  onProgress?: (percent: number) => void;
}

export function uploadFile({ file, config, ocrEnabled, onProgress }: UploadOptions): Promise<IngestResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("embedding_provider", config.embedding_provider);
    form.append("embedding_model", config.embedding_model);
    form.append("embedding_base_url", config.embedding_base_url ?? "");
    form.append("embedding_dimensions", String(config.embedding_dimensions ?? 0));
    form.append("api_key", config.api_key ?? "");
    form.append("ocr_enabled", String(ocrEnabled));
    form.append("max_tokens", "512");

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status === 409) {
        reject(new Error(`Duplicate — this file was already ingested (file #${body.existing_file_id}).`));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as unknown as IngestResult);
      } else {
        reject(new Error(String(body.detail ?? `Upload failed (${xhr.status})`)));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));

    xhr.open("POST", url("/api/ingest"));
    const token = useConfigStore.getState().authToken.trim();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(form);
  });
}

// ---------- Chat streaming (SSE via fetch reader) ----------

export interface StreamChatOptions {
  sessionId: string | null;
  messages: { role: "user"; content: string }[];
  config: ChatConfigPayload;
  signal?: AbortSignal;
}

export async function* streamChat(body: StreamChatOptions): AsyncGenerator<SSEEvent> {
  const response = await fetch(url("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
    signal: body.signal,
  });

  if (!response.ok || !response.body) {
    let detail = response.statusText;
    try {
      const j = await response.json();
      detail = j.detail ?? JSON.stringify(j);
    } catch {
      /* ignore */
    }
    yield { type: "error", message: detail || `Chat failed (${response.status})` };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(6)) as SSEEvent;
      } catch {
        /* skip malformed frame */
      }
    }
  }
}
