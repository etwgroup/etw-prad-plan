// PrądPlan / import metadanych faktur z KSeF DEMO.
// Gdy przeglądarka nie przekaże numerów KSeF, funkcja importuje cały wybrany
// miesiąc. Numery można przekazać tylko dla zachowania kompatybilności ze
// starszym widokiem podglądu.
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

type ExistingInvoice = {
  id: string;
  ksef_number: string | null;
  due_date: string | null;
};

type InvoiceToImport = {
  invoice: KsefInvoice;
  type: "sales" | "purchase";
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

    const importAllForMonth = ksefNumbers.length === 0;
    const requested = new Set(ksefNumbers);
    const current = new Map<string, InvoiceToImport>();
    for (const invoice of sales.invoices) {
      if (importAllForMonth || requested.has(invoice.ksefNumber)) current.set(invoice.ksefNumber, { invoice, type: "sales" });
    }
    for (const invoice of purchases.invoices) {
      if (importAllForMonth || requested.has(invoice.ksefNumber)) current.set(invoice.ksefNumber, { invoice, type: "purchase" });
    }

    const foundNumbers = [...current.keys()];
    const missingCount = importAllForMonth ? 0 : ksefNumbers.length - foundNumbers.length;
    if (!foundNumbers.length) {
      return response.status(200).json({
        imported: 0,
        skipped: 0,
        message: "KSeF DEMO nie zwrócił faktur do importu w wybranym miesiącu.",
      });
    }

    const { data: existingRows, error: existingError } = await callerClient
      .from("invoices")
      .select("id, ksef_number, due_date")
      .in("ksef_number", foundNumbers);
    if (existingError) throw existingError;

    const existingByKsefNumber = new Map(
      ((existingRows || []) as ExistingInvoice[])
        .filter((row) => Boolean(row.ksef_number))
        .map((row) => [row.ksef_number as string, row]),
    );

    // Metadane KSeF nie zawierają terminu płatności. XML jest odczytywany
    // tylko dla nowych faktur i dla wcześniejszych importów bez terminu.
    const dueDateResult = await loadDueDates(
      client,
      [...current.values()].filter(({ invoice }) => {
        const saved = existingByKsefNumber.get(invoice.ksefNumber);
        return !saved || !saved.due_date;
      }),
    );
    const dueDates = dueDateResult.values;

    const toInsert = [...current.values()]
      .filter(({ invoice }) => !existingByKsefNumber.has(invoice.ksefNumber))
      .map(({ invoice, type }) => invoicePayload(invoice, type, caller.user.id, dueDates.get(invoice.ksefNumber) || null));

    if (toInsert.length) {
      const { error: insertError } = await callerClient
        .from("invoices")
        .upsert(toInsert, { onConflict: "ksef_number", ignoreDuplicates: true });
      if (insertError) throw insertError;
    }

    let dueDatesUpdated = 0;
    for (const saved of existingByKsefNumber.values()) {
      const dueDate = !saved.due_date && saved.ksef_number ? dueDates.get(saved.ksef_number) : null;
      if (!dueDate) continue;
      const { error: updateError } = await callerClient
        .from("invoices")
        .update({ due_date: dueDate })
        .eq("id", saved.id);
      if (updateError) throw updateError;
      dueDatesUpdated += 1;
    }

    const skipped = existingByKsefNumber.size + missingCount;
    const skippedMessage = missingCount
      ? `; pominięto ${skipped} już zapisanych lub niedostępnych pozycji`
      : existingByKsefNumber.size ? `; pominięto ${existingByKsefNumber.size} już zapisanych pozycji` : "";
    const dueDateMessage = dueDatesUpdated ? ` Uzupełniono termin płatności w ${dueDatesUpdated} zapisanych pozycjach.` : "";
    const dueDateWarning = dueDateResult.failures
      ? ` Nie udało się odczytać terminu płatności dla ${dueDateResult.failures} faktur; spróbuj ponownie po sprawdzeniu logów Vercel.`
      : "";
    return response.status(200).json({
      imported: toInsert.length,
      skipped,
      dueDatesUpdated,
      message: `Zaimportowano ${toInsert.length} faktur do rejestru PrądPlan${skippedMessage}.${dueDateMessage}${dueDateWarning}`,
    });
  } catch (error) {
    const diagnostic = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "UnknownError";
    console.error("KSeF DEMO invoice import failed", diagnostic);
    return response.status(422).json({
      error: "Nie udało się zaimportować wybranych faktur z KSeF DEMO. Sprawdź logi funkcji Vercel.",
    });
  }
}

function invoicePayload(invoice: KsefInvoice, type: "sales" | "purchase", userId: string, dueDate: string | null) {
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
    due_date: dueDate,
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

async function loadDueDates(client: KSeFClient, invoices: InvoiceToImport[]) {
  const values = new Map<string, string>();
  let failures = 0;
  // Pobieranie dokumentów pojedynczo ogranicza ryzyko odrzucenia serii przez
  // KSeF i nie blokuje importu, jeśli jedna faktura jest niedostępna.
  const workerCount = Math.min(1, invoices.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < invoices.length) {
      const item = invoices[nextIndex++];
      try {
        const xml = await downloadInvoiceXml(client, item.invoice.ksefNumber);
        const dueDate = paymentDueDateFromXml(xml);
        if (dueDate) values.set(item.invoice.ksefNumber, dueDate);
      } catch (error) {
        failures += 1;
        const diagnostic = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "UnknownError";
        console.warn("KSeF DEMO payment due date skipped", item.invoice.ksefNumber, diagnostic);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return { values, failures };
}

async function downloadInvoiceXml(client: KSeFClient, ksefNumber: string) {
  // Dokument pobiera i odszyfrowuje wyłącznie serwer. Rzutowanie zachowuje
  // zgodność z deklaracjami wersji 0.13 klienta KSeF użytej w tym projekcie.
  const invoices = client.invoices as unknown as { getInvoice: (number: string) => Promise<unknown> };
  if (typeof invoices.getInvoice !== "function") {
    throw new Error("Zainstalowana wersja klienta KSeF nie obsługuje pobierania XML faktury.");
  }
  const result = await invoices.getInvoice(ksefNumber);
  return xmlTextFromResult(result);
}

function xmlTextFromResult(value: unknown, depth = 0): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString("utf8");
  if (value && typeof value === "object" && depth < 3) {
    const record = value as Record<string, unknown>;
    for (const key of ["xml", "invoice", "invoiceXml", "content", "data", "body", "payload", "document", "bytes"]) {
      if (record[key] !== undefined) {
        try {
          return xmlTextFromResult(record[key], depth + 1);
        } catch {
          // Próbujemy kolejnego bezpiecznego pola odpowiedzi.
        }
      }
    }
    throw new Error(`KSeF zwrócił XML w nieobsługiwanym formacie (${Object.keys(record).join(", ") || "brak pól"}).`);
  }
  throw new Error("KSeF nie zwrócił treści XML faktury.");
}

function paymentDueDateFromXml(xml: string) {
  const payment = firstTagContent(xml, "Platnosc");
  if (!payment) return null;
  for (const term of tagContents(payment, "TerminPlatnosci")) {
    const value = firstTagText(term, "Termin");
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  return null;
}

function firstTagContent(xml: string, tag: string) {
  return tagContents(xml, tag)[0] || "";
}

function firstTagText(xml: string, tag: string) {
  const content = firstTagContent(xml, tag);
  return content ? decodeXml(content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()) : "";
}

function tagContents(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`<\\s*(?:[\\w.-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\s*\\/\\s*(?:[\\w.-]+:)?${escaped}\\s*>`, "gi");
  return Array.from(xml.matchAll(expression), (match) => match[1]);
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(?:x([0-9a-fA-F]+)|([0-9]+));/g, (_match, hexadecimal, decimal) => {
      const codePoint = Number.parseInt(hexadecimal || decimal, hexadecimal ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    });
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
  if (ksefNumbers.length > PAGE_SIZE * 2) throw new Error("Można przekazać maksymalnie 200 faktur do importu.");
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
