// PrądPlan / test uwierzytelnienia KSeF wykonywany w Node.js na Vercel.
// Certyfikat, klucz i hasło są odczytywane wyłącznie z sekretów Vercel. Ten
// endpoint nie pobiera, nie zapisuje ani nie wysyła faktur do KSeF.
import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import { createPrivateKey } from "node:crypto";
import { KSeFClient } from "ksef-client-ts";

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type KsefEnvironment = "demo" | "production";

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    return response.status(405).json({ error: "Metoda niedozwolona." });
  }

  let environment: KsefEnvironment = "demo";
  try {
    environment = readEnvironment(request.body);
    const token = authorizationToken(request.headers.authorization);
    if (!token) return response.status(401).json({ error: "Brak sesji użytkownika." });

    const projectUrl = requiredEnvironment("SUPABASE_URL");
    const publishableKey = requiredEnvironment("SUPABASE_PUBLISHABLE_KEY");
    const callerClient = createClient(projectUrl, publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: caller, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller.user) {
      return response.status(401).json({ error: "Sesja użytkownika wygasła. Zaloguj się ponownie." });
    }

    const { data: profile, error: profileError } = await callerClient
      .from("profiles")
      .select("role, active")
      .eq("id", caller.user.id)
      .single();

    if (profileError) throw new Error("Nie udało się odczytać uprawnień użytkownika.");
    if (!profile?.active || !["owner", "accountant"].includes(profile.role)) {
      return response.status(403).json({ error: "Brak uprawnień do testu KSeF." });
    }
    if (environment === "production" && profile.role !== "owner") {
      return response.status(403).json({ error: "Test KSeF PRODUKCJA może uruchomić wyłącznie właściciel." });
    }

    const credentials = credentialsFor(environment);
    const client = new KSeFClient({ environment: credentials.clientEnvironment });
    await client.loginWithCertificate(credentials.certificatePem, credentials.privateKeyPem, credentials.nip);

    return response.status(200).json({
      environment,
      message: `Połączenie z ${ksefLabel(environment)} zostało potwierdzone. Nie pobrano, nie zapisano ani nie wysłano faktur.`,
    });
  } catch (error) {
    const diagnostic = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "UnknownError";
    console.error(`${ksefLabel(environment)} connection test failed`, diagnostic);
    return response.status(422).json({
      error: `Test połączenia ${ksefLabel(environment)} nie powiódł się. Sprawdź logi funkcji Vercel.`,
    });
  }
}

function readEnvironment(body: unknown): KsefEnvironment {
  const payload = typeof body === "string" ? JSON.parse(body) : body;
  const value = typeof (payload as { environment?: unknown } | null)?.environment === "string"
    ? (payload as { environment: string }).environment.trim().toLowerCase()
    : "demo";
  if (value !== "demo" && value !== "production") throw new Error("Nieprawidłowe środowisko KSeF.");
  return value;
}

function credentialsFor(environment: KsefEnvironment) {
  const prefix = environment === "production" ? "KSEF_PROD" : "KSEF_DEMO";
  return {
    certificatePem: certificateToPem(requiredEnvironment(`${prefix}_CERTIFICATE_BASE64`)),
    privateKeyPem: privateKeyToPem(
      requiredEnvironment(`${prefix}_PRIVATE_KEY_BASE64`),
      process.env[`${prefix}_PRIVATE_KEY_PASSWORD`] || "",
    ),
    nip: requiredEnvironment(`${prefix}_NIP`),
    clientEnvironment: environment === "production" ? "PROD" as const : "DEMO" as const,
  };
}

function ksefLabel(environment: KsefEnvironment) {
  return environment === "production" ? "KSeF PRODUKCJA" : "KSeF DEMO";
}

function authorizationToken(header: string | string[] | undefined) {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : "";
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Brakuje zmiennej środowiskowej ${name}.`);
  return value;
}

function certificateToPem(base64: string) {
  const bytes = Buffer.from(base64.replace(/\s/g, ""), "base64");
  const text = bytes.toString("utf8").trim();
  return text.includes("-----BEGIN CERTIFICATE-----") ? text : pem("CERTIFICATE", bytes);
}

function privateKeyToPem(base64: string, passphrase: string) {
  const bytes = Buffer.from(base64.replace(/\s/g, ""), "base64");
  const text = bytes.toString("utf8").trim();
  const encrypted = text.includes("-----BEGIN ENCRYPTED PRIVATE KEY-----") || text.includes("Proc-Type: 4,ENCRYPTED");
  const key = text.includes("-----BEGIN")
    ? createPrivateKey(encrypted ? { key: text, format: "pem", passphrase } : { key: text, format: "pem" })
    : createPrivateKey({ key: bytes, format: "der", type: "pkcs8", ...(passphrase ? { passphrase } : {}) });
  return key.export({ type: "pkcs8", format: "pem" }).toString();
}

function pem(label: string, bytes: Buffer) {
  const body = bytes.toString("base64").match(/.{1,64}/g)?.join("\n") || "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
}
