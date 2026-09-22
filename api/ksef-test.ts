// PrądPlan / test uwierzytelnienia KSeF DEMO wykonywany w Node.js na Vercel.
// Certyfikat, klucz i hasło są odczytywane wyłącznie z Vercel Environment
// Variables. Ten endpoint nie pobiera ani nie zapisuje faktur.
import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import { createPrivateKey } from "node:crypto";
import { KSeFClient } from "ksef-client-ts";

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

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

  try {
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

    const certificatePem = certificateToPem(requiredEnvironment("KSEF_DEMO_CERTIFICATE_BASE64"));
    const privateKeyPem = privateKeyToPem(
      requiredEnvironment("KSEF_DEMO_PRIVATE_KEY_BASE64"),
      process.env.KSEF_DEMO_PRIVATE_KEY_PASSWORD || "",
    );

    const client = new KSeFClient({ environment: "DEMO" });
    await client.loginWithCertificate(certificatePem, privateKeyPem, requiredEnvironment("KSEF_DEMO_NIP"));

    return response.status(200).json({
      message: "Połączenie z KSeF DEMO zostało potwierdzone. Nie pobrano ani nie zapisano faktur.",
    });
  } catch (error) {
    const diagnostic = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "UnknownError";
    console.error("KSeF DEMO connection test failed", diagnostic);
    return response.status(422).json({
      error: "Test połączenia KSeF DEMO nie powiódł się. Sprawdź logi funkcji Vercel.",
    });
  }
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
