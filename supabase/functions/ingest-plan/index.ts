// HMA Cadence — `ingest-plan` Edge Function
//
// Receiving endpoint for the Tracker → Cadence plan push (contract v1).
// Thin gateway: authenticate the shared secret, then hand the whole
// payload to the atomic `apply_plan` Postgres function (migration 0004),
// which does the real work under service_role.
//
// Deploy with JWT verification OFF (we authenticate via our own shared
// secret, not a Supabase JWT):
//   supabase functions deploy ingest-plan --no-verify-jwt
//
// Required secret (service_role + url are auto-injected by Supabase):
//   supabase secrets set INGEST_SHARED_SECRET=<the-token-the-tracker-uses>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const INGEST_SECRET = Deno.env.get("INGEST_SHARED_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

// Constant-time string comparison to avoid leaking the secret via timing.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // ── auth: shared secret ──
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!INGEST_SECRET || !timingSafeEqual(token, INGEST_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  // ── parse ──
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  // ── version guard (fail loudly if the Tracker is ahead of us) ──
  if (payload?.schema_version !== 1) {
    return json(
      { error: "unsupported schema_version", schema_version: payload?.schema_version ?? null },
      409,
    );
  }

  // ── apply atomically in the DB ──
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase.rpc("apply_plan", { payload });

  if (error) return json({ status: "error", error: error.message }, 500);
  if ((data as { status?: string })?.status === "error") return json(data, 422);
  return json(data, 200); // applied | duplicate
});
