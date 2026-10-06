import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { accounts, sessions } from "../db/schema";
import { passwordHash, randomHex, sessionCookie, sessionToken, sha256, SESSION_SECONDS } from "../lib/password";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function json(value: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", ...extra } });
}
export async function platformUser() {
  if (!process.env.DATABASE_URL) throw new ApiError(503, "Add DATABASE_URL in Vercel, then run the database setup command to open your workspace.");
  return { userId: process.env.WORKSPACE_ID || "permitline-owner", fullName: process.env.WORKSPACE_NAME || "Your workspace" };
}
export async function isUnlocked(request: Request, userId: string): Promise<boolean> {
  const token = sessionToken(request); if (!token) return false;
  const [session] = await getDb().select().from(sessions).where(and(eq(sessions.tokenHash, await sha256(token)), eq(sessions.userId, userId), gt(sessions.expiresAt, Date.now()))).limit(1);
  return !!session;
}
export async function unlockedUser(request: Request) {
  const user = await platformUser();
  if (!await isUnlocked(request, user.userId)) throw new ApiError(401, "Your workspace is locked. Enter your password to continue.");
  return user;
}
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new ApiError(403, "This request must come from your workspace.");
}
export async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "Send a JSON request.");
  const text = await request.text();
  if (text.length > 64000) throw new ApiError(413, "This request is too large.");
  try { return JSON.parse(text); } catch { throw new ApiError(400, "The request could not be read."); }
}
export async function issueSession(request: Request, userId: string): Promise<string> {
  const token = randomHex(); const db = getDb();
  await db.insert(sessions).values({ tokenHash: await sha256(token), userId, expiresAt: Date.now() + SESSION_SECONDS * 1000 });
  return sessionCookie(token, request);
}
export async function getAccount(userId: string) { return (await getDb().select().from(accounts).where(eq(accounts.userId, userId)).limit(1))[0]; }
export async function initializeAccount(userId: string) {
  const current = await getAccount(userId);
  if (current) return current;
  const initial = process.env.WORKSPACE_PASSWORD;
  if (!initial || initial.length < 10 || initial.length > 200) throw new ApiError(503, "Set WORKSPACE_PASSWORD in Vercel to a private password of 10–200 characters before the first login.");
  const salt = randomHex(24), hash = await passwordHash(initial, salt);
  await getDb().insert(accounts).values({ userId, passwordHash: hash, passwordSalt: salt, createdAt: Date.now() }).onConflictDoNothing();
  const account = await getAccount(userId);
  if (!account) throw new ApiError(503, "Your password could not be initialized. Please try again.");
  return account;
}
export async function handleError(error: unknown): Promise<Response> {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  if (error && typeof error === "object" && "name" in error && error.name === "ZodError") return json({ error: "Please check the fields and try again." }, 400);
  console.error("Permitline request failed:", error instanceof Error ? error.name : "Unknown error");
  return json({ error: "The workspace could not complete this request. Please try again." }, 503);
}
