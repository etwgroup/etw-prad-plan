// PrądPlan / usuwanie faktury tylko przez właściciela po ponownym podaniu hasła.
// Klucz service_role istnieje wyłącznie jako sekret Vercel. Dzięki temu RLS może
// całkowicie zablokować bezpośrednie usuwanie faktur z przeglądarki.
import { createClient } from "@supabase/supabase-js";

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type DeleteRequest = {
  invoiceId: string;
  password: string;
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    return response.status(405).json({ error: "Metoda niedozwolona." });
  }

  try {
    const token = authorizationToken(request.headers.authorization);
    if (!token) return response.status(401).json({ error: "Brak sesji użytkownika." });

    const { invoiceId, password } = readDeleteRequest(request.body);
    const projectUrl = requiredEnvironment("SUPABASE_URL");
    const publishableKey = requiredEnvironment("SUPABASE_PUBLISHABLE_KEY");
    const callerClient = createClient(projectUrl, publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: caller, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller.user?.email) {
      return response.status(401).json({ error: "Sesja użytkownika wygasła. Zaloguj się ponownie." });
    }

    const { data: profile, error: profileError } = await callerClient
      .from("profiles")
      .select("role, active")
      .eq("id", caller.user.id)
      .single();
    if (profileError) throw new Error("Nie udało się odczytać uprawnień użytkownika.");
    if (!profile?.active || profile.role !== "owner") {
      return response.status(403).json({ error: "Fakturę może usunąć wyłącznie właściciel." });
    }

    // Supabase Auth weryfikuje ponownie hasło właściciela. Hasło nigdy nie jest
    // zapisane, logowane ani przesyłane dalej niż do bezpiecznego API Auth.
    const verificationClient = createClient(projectUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verification, error: passwordError } = await verificationClient.auth.signInWithPassword({
      email: caller.user.email,
      password,
    });
    if (passwordError || verification.user?.id !== caller.user.id) {
      return response.status(401).json({ error: "Hasło właściciela jest nieprawidłowe." });
    }

    const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
    const adminClient = createClient(projectUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: deleteError } = await adminClient
      .from("invoices")
      .delete()
      .eq("id", invoiceId);
    if (deleteError) throw deleteError;

    return response.status(200).json({ message: "Faktura została usunięta." });
  } catch (error) {
    const diagnostic = errorDiagnostic(error);
    console.error("Invoice deletion failed", diagnostic);
    const configurationError = diagnostic.includes("SUPABASE_SERVICE_ROLE_KEY");
    const permissionError = /permission denied|42501|not authorized/i.test(diagnostic);
    return response.status(500).json({
      error: configurationError
        ? "Usuwanie faktur wymaga konfiguracji bezpiecznego sekretu serwerowego w Vercel."
        : permissionError
          ? "Serwer nie ma uprawnienia do usunięcia faktury. Sprawdź sekret SUPABASE_SERVICE_ROLE_KEY w Vercel."
        : "Nie udało się usunąć faktury. Spróbuj ponownie.",
    });
  }
}

function authorizationToken(header: string | string[] | undefined) {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : "";
}

function readDeleteRequest(value: unknown): DeleteRequest {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Nieprawidłowe dane żądania.");
  const { invoiceId, password } = body as { invoiceId?: unknown; password?: unknown };
  if (typeof invoiceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)) {
    throw new Error("Nieprawidłowy identyfikator faktury.");
  }
  if (typeof password !== "string" || !password) throw new Error("Podaj hasło właściciela.");
  return { invoiceId, password };
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Brakuje zmiennej środowiskowej ${name}.`);
  return value;
}

function errorDiagnostic(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 500);
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error).slice(0, 500);
    } catch {
      return "Nie udało się odczytać szczegółów błędu.";
    }
  }
  return String(error || "Nieznany błąd.").slice(0, 500);
}
