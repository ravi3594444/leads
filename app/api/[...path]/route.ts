import { env } from "../../../server/env";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../db";
import { accounts, assessments, leadStates, preferences, sessions } from "../../../db/schema";
import { constantTimeEqual, passwordHash, randomHex, sessionCookie, sessionToken, sha256 } from "../../../lib/password";
import { ageInDays, makeCsv, permitActivityDate } from "../../../lib/permit-utils";
import type { Assessment, LeadState } from "../../../lib/types";
import { ApiError, assertSameOrigin, body, getAccount, handleError, initializeAccount, isUnlocked, issueSession, json, platformUser, unlockedUser } from "../../../server/http";
import { assessmentInput, backendConnected, leadsFor, permitById, permitExport, permitPage, profileFor, profileSchema, sourcesFor, useCollectorApi } from "../../../server/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const credentials = z.object({ password: z.string().min(10).max(200) });

async function serve(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url), path = url.pathname.replace(/^\/api\//, ""), write = request.method !== "GET";
    if (write) assertSameOrigin(request);

    if (path === "auth/status" && request.method === "GET") {
      const user = await platformUser();
      const account = await getAccount(user.userId);
      if (!account && (!env.WORKSPACE_PASSWORD || env.WORKSPACE_PASSWORD.length < 10 || env.WORKSPACE_PASSWORD.length > 200)) throw new ApiError(503, "Set WORKSPACE_PASSWORD in Vercel to a private password of 10–200 characters before the first login.");
      return json({ signedIn: true, setupRequired: false, unlocked: await isUnlocked(request, user.userId), displayName: user.fullName });
    }
    if (path === "auth/setup" && request.method === "POST") {
      throw new ApiError(403, "The workspace password must be configured by its owner in Vercel. Public password setup is disabled.");
    }
    if (path === "auth/login" && request.method === "POST") {
      const user = await platformUser(), input = credentials.parse(await body(request)), account = await initializeAccount(user.userId), db = getDb();
      if (account.lockUntil > Date.now()) throw new ApiError(429, "Too many attempts. Please wait five minutes and try again.");
      const valid = constantTimeEqual(await passwordHash(input.password, account.passwordSalt), account.passwordHash);
      if (!valid) {
        await db.update(accounts).set({ failedAttempts: sql`${accounts.failedAttempts} + 1`, lockUntil: sql`CASE WHEN ${accounts.failedAttempts} >= 4 THEN ${Date.now() + 300000}::bigint ELSE 0::bigint END` }).where(eq(accounts.userId, user.userId));
        throw new ApiError(401, "That password isn't correct. Please try again.");
      }
      await db.update(accounts).set({ failedAttempts: 0, lockUntil: 0 }).where(eq(accounts.userId, user.userId));
      return json({ ok: true }, 200, { "Set-Cookie": await issueSession(request, user.userId) });
    }
    if (path === "auth/logout" && request.method === "POST") {
      const user = await platformUser(), token = sessionToken(request);
      if (token) await getDb().delete(sessions).where(and(eq(sessions.userId, user.userId), eq(sessions.tokenHash, await sha256(token))));
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", request, true) });
    }

    const user = await unlockedUser(request), userId = user.userId, db = getDb();
    if (path === "workspace" && request.method === "GET") {
      return json({ profile: await profileFor(userId), leads: await leadsFor(userId), jevConnected: !!env.AIMLAPI_KEY, backendConnected: await backendConnected(), displayName: user.fullName || "Your workspace" });
    }
    if (path === "profile" && request.method === "POST") {
      const profile = profileSchema.parse(await body(request));
      if (profile.jevEnabled && !env.AIMLAPI_KEY) throw new ApiError(409, "Jev isn't connected yet. Your service profile can still be saved.");
      await db.insert(preferences).values({ userId, payload: JSON.stringify(profile), updatedAt: Date.now() }).onConflictDoUpdate({ target: preferences.userId, set: { payload: JSON.stringify(profile), updatedAt: Date.now() } });
      await db.delete(assessments).where(eq(assessments.userId, userId));
      return json({ profile });
    }
    if (path === "leads" && request.method === "POST") {
      const schema = z.object({ updates: z.array(z.object({ id: z.string().min(1).max(200), status: z.enum(["new", "saved", "contacted", "won", "dismissed"]).optional(), notes: z.string().max(10000).optional() })).min(1).max(100) });
      const { updates } = schema.parse(await body(request)), existing = await leadsFor(userId);
      for (const update of updates) {
        const status = update.status ?? existing[update.id]?.status ?? "new", notes = update.notes ?? existing[update.id]?.notes ?? "", updatedAt = Date.now();
        await db.insert(leadStates).values({ userId, permitId: update.id, status, notes, updatedAt }).onConflictDoUpdate({ target: [leadStates.userId, leadStates.permitId], set: { status, notes, updatedAt } });
      }
      return json({ leads: await leadsFor(userId) });
    }
    if (path === "auth/password" && request.method === "POST") {
      const { currentPassword, password } = z.object({ currentPassword: z.string().max(200), password: z.string().min(10).max(200) }).parse(await body(request));
      const account = await getAccount(userId);
      if (!account || !constantTimeEqual(await passwordHash(currentPassword, account.passwordSalt), account.passwordHash)) throw new ApiError(401, "Your current password isn't correct.");
      const salt = randomHex(24);
      await db.update(accounts).set({ passwordHash: await passwordHash(password, salt), passwordSalt: salt, failedAttempts: 0, lockUntil: 0 }).where(eq(accounts.userId, userId));
      await db.delete(sessions).where(eq(sessions.userId, userId));
      return json({ ok: true }, 200, { "Set-Cookie": await issueSession(request, userId) });
    }
    if (path === "permits" && request.method === "GET") return json(await permitPage(userId, url.searchParams));
    if (path.startsWith("permits/") && request.method === "GET") return json({ permit: await permitById(userId, decodeURIComponent(path.slice(8))) });
    if (path === "sources" && request.method === "GET") return json(await sourcesFor());
    if (path === "export" && request.method === "GET") {
      if (useCollectorApi()) {
        const query = new URLSearchParams(url.searchParams); query.set("profile", JSON.stringify(await profileFor(userId)));
        const viewLeads = await leadsFor(userId);
        if (query.get("view") === "saved") query.set("ids", Object.keys(viewLeads).filter(id => !["new", "dismissed"].includes(viewLeads[id].status) && (!query.get("leadStatus") || query.get("leadStatus") === "all" || viewLeads[id].status === query.get("leadStatus"))).join(","));
        query.set("dismissedIds", Object.keys(viewLeads).filter(id => viewLeads[id].status === "dismissed").join(","));
        const response = await fetch(`${env.PERMIT_API_URL!.replace(/\/$/, "")}/api/permits/export?${query}`, { headers: { Authorization: `Bearer ${env.PERMIT_API_TOKEN}` }, signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new ApiError(502, "The permit feed could not export these results.");
        return new Response(response.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="permitline-permits.csv"', "Cache-Control": "no-store" } });
      }
      const exported = await permitExport(userId, url.searchParams);
      return new Response(makeCsv(exported.permits, await leadsFor(userId)), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="permitline-permits.csv"', "Cache-Control": "no-store, private", "X-Exported-Rows": String(exported.permits.length), "X-Total-Matching": String(exported.total), "X-Export-Limit": String(exported.limit) } });
    }
    if (path === "jev/assess" && request.method === "POST") {
      if (!env.AIMLAPI_KEY) throw new ApiError(409, "Jev isn't connected yet. Use the priority preview while we connect your API key.");
      const { ids } = z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(10) }).parse(await body(request));
      const profile = await profileFor(userId), results: Record<string, Assessment> = {};
      for (const id of Array.from(new Set(ids))) {
        const permit = await permitById(userId, id), input = assessmentInput(permit, profile), inputHash = await sha256(input);
        const [cached] = await db.select().from(assessments).where(and(eq(assessments.userId, userId), eq(assessments.permitId, id))).limit(1);
        if (cached?.inputHash === inputHash) { results[id] = JSON.parse(cached.payload); continue; }
        const response = await fetch("https://api.aimlapi.com/v1/decisions", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.AIMLAPI_KEY}` }, signal: AbortSignal.timeout(15000),
          body: JSON.stringify({ model: "typesafe/jev", state: input, questions: {
            service_fit: { type: "score", instructions: "Evaluate the permit work's relevance to the profile's selected services. If no services are selected, evaluate relevance to general contracting. Evaluate service fit only, not the probability of winning a sale.", criteria: ["No relevant work", "Little relevant work", "Some relevant work", "Clearly relevant work", "Direct match to the selected services"] },
            scope_clarity: { type: "score", instructions: "How clearly does this description identify the work involved?", criteria: ["Insufficient scope information", "Partly specified work", "Clearly specified work"] },
            trade: { type: "choice", instructions: "Which trade primarily matches this permit's scope?", criteria: { "General contracting": "Building, additions or work spanning several trades", Roofing: "Roof replacement, repair or installation", HVAC: "Air conditioning, heating or ventilation", Electrical: "Electrical service, wiring or lighting", Plumbing: "Pipes, fixtures or drainage", Remodeling: "Interior alterations and finishes", Pools: "Pool construction or refurbishment", "Site work": "Grading, site access or site drainage" } },
          } }),
        });
        if (!response.ok) throw new ApiError(502, "Jev couldn't complete this assessment. Please try again.");
        const result = await response.json() as { model?: string; answers?: Record<string, { score?: number; confidence?: number; choice?: string }> };
        const fit = result.answers?.service_fit, scope = result.answers?.scope_clarity;
        if (!fit || !scope || !Number.isFinite(fit.score) || !Number.isFinite(scope.score) || fit.score! < 0 || fit.score! > 4 || scope.score! < 0 || scope.score! > 2) throw new ApiError(502, "Jev returned an assessment we couldn't validate.");
        const freshness = Math.max(0, Math.min(1, 1 - (ageInDays(permitActivityDate(permit)) ?? 30) / 30));
        const assessment: Assessment = { score: Math.round((fit.score! / 4 * 0.7 + scope.score! / 2 * 0.2 + freshness * 0.1) * 100), confidence: Number.isFinite(fit.confidence) ? Math.max(0, Math.min(1, fit.confidence!)) : null, trade: result.answers?.trade?.choice || permit.trade, model: result.model || "typesafe/jev", assessedAt: new Date().toISOString() };
        await db.insert(assessments).values({ userId, permitId: id, inputHash, payload: JSON.stringify(assessment), createdAt: Date.now() }).onConflictDoUpdate({ target: [assessments.userId, assessments.permitId], set: { inputHash, payload: JSON.stringify(assessment), createdAt: Date.now() } });
        results[id] = assessment;
      }
      return json({ assessments: results });
    }
    throw new ApiError(404, "This endpoint could not be found.");
  } catch (error) { return handleError(error); }
}
export const GET = serve;
export const POST = serve;
