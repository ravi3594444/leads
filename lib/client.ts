export class ClientError extends Error { constructor(message: string, public status: number) { super(message); } }
type ApiOptions = RequestInit & { timeoutMs?: number };
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { timeoutMs = path === "/api/jev/assess" ? 180000 : 20000, signal: callerSignal, ...requestOptions } = options;
  if (callerSignal?.aborted) throw callerSignal.reason;
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const headers = new Headers(requestOptions.headers);
    if (requestOptions.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...requestOptions, signal: controller.signal, headers, credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("permitline:locked"));
    let data: unknown;
    try { data = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw new ClientError("The workspace couldn't read this response. Please try again.", response.ok ? 502 : response.status);
    }
    if (!response.ok) {
      const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "This request couldn't be completed.";
      throw new ClientError(message, response.status);
    }
    return data as T;
  } catch (error) {
    if (callerSignal?.aborted) throw callerSignal.reason;
    if (timedOut) throw new ClientError(requestOptions.method && requestOptions.method !== "GET"
      ? "This request is taking too long. Refresh the workspace to check whether it completed before trying again."
      : "The workspace is taking too long to respond. Please try again.", 408);
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", cancel);
  }
}
export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
