// PrądPlan / bezpieczne tworzenie kont przez właściciela.
// Wymaga sekretu SUPABASE_SERVICE_ROLE_KEY ustawionego wyłącznie w Supabase.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const projectUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = request.headers.get("Authorization") || "";
    const callerClient = createClient(projectUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: caller, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller.user) throw new Error("Brak prawidłowej sesji użytkownika.");

    const admin = createClient(projectUrl, serviceRoleKey);
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role, active")
      .eq("id", caller.user.id)
      .single();
    if (callerProfile?.role !== "owner" || !callerProfile.active) {
      return json({ error: "Tylko właściciel może tworzyć konta." }, 403);
    }

    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const fullName = String(body.fullName || "").trim();
    const role = String(body.role || "viewer");
    if (!email || !password || password.length < 10 || !["manager", "accountant", "viewer", "owner"].includes(role)) {
      return json({ error: "Podaj firmowy e-mail, hasło o długości min. 10 znaków oraz poprawną rolę." }, 400);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createError || !created.user) throw createError || new Error("Nie utworzono użytkownika.");

    const { error: profileError } = await admin.from("profiles").upsert({
      id: created.user.id,
      email,
      full_name: fullName,
      role,
      active: true,
    });
    if (profileError) throw profileError;
    return json({ id: created.user.id, email, role }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Nie udało się utworzyć konta." }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
