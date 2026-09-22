// PrądPlan / podgląd metadanych faktur z KSeF DEMO.
// Endpoint działa wyłącznie po stronie Node.js na Vercel. Zwraca podgląd dla
// wybranego miesiąca, ale nie zapisuje danych w Supabase ani w PrądPlan.
import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import { createPrivateKey } from "node:crypto";
import { InvoiceQueryFilterBuilder, KSeFClient } from "ksef-client-ts";

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

const PAGE_SIZE = 100;

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    return response.status(405).json({ error: "Metoda niedozwolona." });
  }

  try {
    const token = authorizationToken(request.headers.authorization);
    if (!token) return response.status(401).json({ error: "Brak sesji użytkownika." });

    const month = readMonth(request.body);
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
      return response.status(403).json({ error: "Brak uprawnień do podglądu KSeF." });
    }

    const certificatePem = certificateToPem(requiredEnvironment("KSEF_DEMO_CERTIFICATE_BASE64"));
    const privateKeyPem = privateKeyToPem(
      requiredEnvironment("KSEF_DEMO_PRIVATE_KEY_BASE64"),
      process.env.KSEF_DEMO_PRIVATE_KEY_PASSWORD || "",
    );
    const client = new KSeFClient({ environment: "DEMO" });
    await client.loginWithCertificate(certificatePem, privateKeyPem, requiredEnvironment("KSEF_DEMO_NIP"));

    const { from, to } = monthRange(month);
    const salesFilter = new InvoiceQueryFilterBuilder()
      .withSubjectType("Subject1")
      .withDateRange("Issue", from, to)
      .build();
    const purchaseFilter = new InvoiceQueryFilterBuilder()
      .withSubjectType("Subject2")
      .withDateRange("Issue", from, to)
      .build();

    const [sales, purchases] = await Promise.all([
      client.invoices.queryInvoiceMetadata(salesFilter, 0, PAGE_SIZE, "Desc"),
      client.invoices.queryInvoiceMetadata(purchaseFilter, 0, PAGE_SIZE, "Desc"),
    ]);

    const invoices = [
      ...sales.invoices.map((invoice) => previewInvoice(invoice, "sales")),
      ...purchases.invoices.map((invoice) => previewInvoice(invoice, "purchase")),
    ].sort((left, right) => right.issueDate.localeCompare(left.issueDate));

    return response.status(200).json({
      month,
      invoices,
      limited: sales.hasMore || purchases.hasMore || sales.isTruncated || purchases.isTruncated,
      message: `Pobrano podgląd ${invoices.length} faktur z KSeF DEMO. Dane nie zostały jeszcze zapisane w PrądPlan.`,
    });
  } catch (error) {
    const diagnostic = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "UnknownError";
    console.error("KSeF DEMO invoice preview failed", diagnostic);
    return response.status(422).json({
      error: "Nie udało się pobrać podglądu faktur z KSeF DEMO. Sprawdź logi funkcji Vercel.",
    });
  }
}

function previewInvoice(invoice: {
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  seller: { nip: string; name?: string };
  buyer: { identifier: { value?: string }; name?: string };
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  currency: string;
}, type: "sales" | "purchase") {
  const counterparty = type === "sales"
    ? invoice.buyer.name || invoice.buyer.identifier.value || "—"
    : invoice.seller.name || invoice.seller.nip || "—";

  return {
    type,
    ksefNumber: invoice.ksefNumber,
    documentNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate.slice(0, 10),
    counterparty,
    netAmount: invoice.netAmount,
    vatAmount: invoice.vatAmount,
    grossAmount: invoice.grossAmount,
    currency: invoice.currency || "PLN",
  };
}

function readMonth(body: unknown) {
  const payload = typeof body === "string" ? JSON.parse(body) : body;
  const month = typeof (payload as { month?: unknown } | null)?.month === "string"
    ? (payload as { month: string }).month
    : "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Nieprawidłowy miesiąc podglądu.");
  }
  return month;
}

function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    from: `${month}-01T00:00:00.000Z`,
    to: `${month}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`,
  };
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
