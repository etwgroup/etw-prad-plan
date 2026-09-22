// PrądPlan / zapis wybranych metadanych faktur z KSeF DEMO.
// Do serwera trafiają tylko numery zaznaczone w aktualnym podglądzie. Funkcja
// odczytuje dane ponownie z KSeF, dzięki czemu kwoty nie pochodzą z przeglądarki.
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

type KsefInvoice = {
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  seller: { nip: string; name?: string };
  buyer: { identifier: { value?: string }; name?: string };
  netAmount: number;
  vatAmount: number;
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

    const { month, ksefNumbers } = readImportRequest(request.body);
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
      return response.status(403).json({ error: "Brak uprawnień do importu KSeF." });
    }

    const certificatePem = certificateToPem(requiredEnvironment("KSEF_DEMO_CERTIFICATE_BASE64"));
    const privateKeyPem = privateKeyToPem(
      requiredEnvironment("KSEF_DEMO_PRIVATE_KEY_BASE64"),
      process.env.KSEF_DEMO_PRIVATE_KEY_PASSWORD || "",
    );
    const client = new KSeFClient({ environment: "DEMO" });
    await client.loginWithCertificate(certificatePem, privateKeyPem, requiredEnvironment("KSEF_DEMO_NIP"));

    const { from, to } = monthRange(month);
    const [sales, purchases] = await Promise.all([
      client.invoices.queryInvoiceMetadata(new InvoiceQueryFilterBuilder().withSubjectType("Subject1").withDateRange("Issue", from, to).build(), 0, PAGE_SIZE, "Desc"),
      client.invoices.queryInvoiceMetadata(new InvoiceQueryFilterBuilder().withSubjectType("Subject2").withDateRange("Issue", from, to).build(), 0, PAGE_SIZE, "Desc"),
    ]);

    const requested = new Set(ksefNumbers);
    const current = new Map<string, { invoice: KsefInvoice; type: "sales" | "purchase" }>();
    for (const invoice of sales.invoices) {
      if (requested.has(invoice.ksefNumber)) current.set(invoice.ksefNumber, { invoice, type: "sales" });
    }
    for (const invoice of purchases.invoices) {
      if (requested.has(invoice.ksefNumber)) current.set(invoice.ksefNumber, { invoice, type: "purchase" });
    }

    const foundNumbers = [...current.keys()];
    const missingCount = ksefNumbers.length - foundNumbers.length;
    if (!foundNumbers.length) {
      return response.status(404).json({ error: "Wybrane faktury nie są już dostępne w podglądzie KSeF. Pobierz podgląd ponownie." });
    }

    const { data: existingRows, error: existingError } = await callerClient
      .from("invoices")
      .select("ksef_number")
      .in("ksef_number", foundNumbers);
    if (existingError) throw existingError;
    const existing = new Set((existingRows || []).map((row) => row.ksef_number).filter(Boolean));
    const toInsert = [...current.values()]
      .filter(({ invoice }) => !existing.has(invoice.ksefNumber))
      .map(({ invoice, type }) => invoicePayload(invoice, type, caller.user.id));

    if (toInsert.length) {
      const { error: insertError } = await callerClient
        .from("invoices")
        .upsert(toInsert, { onConflict: "ksef_number", ignoreDuplicates: true });
      if (insertError) throw insertError;
    }

    const skipped = existing.size + missingCount;
    return response.status(200).json({
      imported: toInsert.length,
      skipped,
      message: `Zaimportowano ${toInsert.length} faktur do rejestru PrądPlan${skipped ? `; pominięto ${skipped} już zapisanych lub niedostępnych pozycji` : ""}.`,
    });
  } catch (error) {
    const diagnostic = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "UnknownError";
    console.error("KSeF DEMO invoice import failed", diagnostic);
    return response.status(422).json({
      error: "Nie udało się zaimportować wybranych faktur z KSeF DEMO. Sprawdź logi funkcji Vercel.",
    });
  }
}

function invoicePayload(invoice: KsefInvoice, type: "sales" | "purchase", userId: string) {
  const netAmount = numberToCents(invoice.netAmount, "kwotę netto");
  const vatAmount = numberToCents(invoice.vatAmount, "kwotę VAT");
  const effectiveVatRate = netAmount > 0 ? Math.round((vatAmount / netAmount) * 10000) / 100 : 0;
  if (effectiveVatRate < 0 || effectiveVatRate > 100) throw new Error("Nieprawidłowa stawka VAT zwrócona przez KSeF.");
  const counterparty = type === "sales"
    ? invoice.buyer.name || invoice.buyer.identifier.value || "Brak danych kontrahenta"
    : invoice.seller.name || invoice.seller.nip || "Brak danych kontrahenta";

  return {
    invoice_type: type,
    source: "ksef",
    document_number: invoice.invoiceNumber || invoice.ksefNumber,
    ksef_number: invoice.ksefNumber,
    counterparty,
    issue_date: invoice.issueDate.slice(0, 10),
    due_date: null,
    net_amount_cents: netAmount,
    vat_rate: effectiveVatRate,
    allocation: "unassigned",
    contract_id: null,
    company_category: null,
    payment_status: "nowa",
    created_by: userId,
    ksef_imported_at: new Date().toISOString(),
  };
}

function numberToCents(value: number, label: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`KSeF zwrócił nieprawidłową ${label}.`);
  return Math.round(amount * 100);
}

function readImportRequest(body: unknown) {
  const payload = typeof body === "string" ? JSON.parse(body) : body;
  const month = typeof (payload as { month?: unknown } | null)?.month === "string"
    ? (payload as { month: string }).month
    : "";
  const rawNumbers = Array.isArray((payload as { ksefNumbers?: unknown[] } | null)?.ksefNumbers)
    ? (payload as { ksefNumbers: unknown[] }).ksefNumbers
    : [];
  const ksefNumbers = [...new Set(rawNumbers.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Nieprawidłowy miesiąc importu.");
  if (!ksefNumbers.length || ksefNumbers.length > PAGE_SIZE * 2) throw new Error("Wybierz od 1 do 200 faktur do importu.");
  return { month, ksefNumbers };
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
