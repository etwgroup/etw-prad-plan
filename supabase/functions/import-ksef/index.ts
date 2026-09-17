// PrądPlan / kolejka bezpiecznego importu KSeF.
// Ten endpoint tworzy ślad importu po zweryfikowaniu roli użytkownika.
// Właściwy adapter KSeF należy podłączyć po ustawieniu firmowego certyfikatu
// lub tokenu jako sekretów Edge Function; nie wolno przenosić ich do przeglądarki.
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
    const { data: profile } = await admin.from("profiles").select("role, active").eq("id", caller.user.id).single();
    if (!profile?.active || !["owner", "accountant"].includes(profile.role)) return json({ error: "Brak uprawnień do importu KSeF." }, 403);

    const environment = (await request.json().catch(() => ({}))).environment === "production" ? "production" : "test";
    const { data: run, error: runError } = await admin.from("invoice_import_runs").insert({
      status: "queued", environment, requested_by: caller.user.id,
    }).select("id, status, environment, created_at").single();
    if (runError) throw runError;

    if (!Deno.env.get("KSEF_API_URL") || !Deno.env.get("KSEF_ACCESS_TOKEN")) {
      await admin.from("invoice_import_runs").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: "Brak skonfigurowanego połączenia KSeF. Ustaw sekrety KSEF_API_URL i KSEF_ACCESS_TOKEN w Edge Function.",
      }).eq("id", run.id);
      return json({ ...run, configured: false, message: "Kolejka została zapisana, ale połączenie KSeF wymaga konfiguracji sekretów serwerowych." });
    }

    // Adapter konkretnej wersji API KSeF jest wykonywany wyłącznie tutaj.
    // Nie zapisuj odpowiedzi bezpośrednio bez walidacji, mapowania danych i deduplikacji po ksef_number.
    return json({ ...run, configured: true, message: "Połączenie KSeF jest skonfigurowane. Dodaj adapter API przed użyciem produkcyjnym." });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Nie udało się uruchomić importu." }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
