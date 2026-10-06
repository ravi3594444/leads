export class ClientError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { ...(options?.body ? { "Content-Type": "application/json" } : {}), ...options?.headers }, credentials: "same-origin", cache: "no-store" });
  const data = await response.json().catch(() => ({ error: "The workspace couldn't read this response. Please try again." }));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("permitline:locked"));
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "This request couldn't be completed.";
    throw new ClientError(message, response.status);
  }
  return data as T;
}
export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
