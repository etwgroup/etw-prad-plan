// PrądPlan / import metadanych faktur z KSeF DEMO albo PRODUKCJI.
// Gdy przeglądarka nie przekaże numerów KSeF, funkcja importuje cały wybrany
// miesiąc. Numery można przekazać tylko dla zachowania kompatybilności ze
// starszym widokiem podglądu. Funkcja nie ma ścieżki wysyłania dokumentów.
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
  // API KSeF zwraca liczby, lecz tolerujemy też zapis tekstowy spotykany
  // w odpowiedziach pośrednich bibliotek (np. "1 234,56").
  netAmount: unknown;
  vatAmount: unknown;
};

type ExistingInvoice = {
  id: string;
  ksef_number: string | null;
  due_date: string | null;
  ksef_details_synced_at: string | null;
};

type KsefEnvironment = "demo" | "production";

type InvoiceToImport = {
  invoice: KsefInvoice;
  type: "sales" | "purchase";
};

type AssignmentRule = {
  active: boolean;
  priority: number;
  invoice_type: "sales" | "purchase" | null;
  match_nip: string | null;
  match_text: string | null;
  target_type: "contract" | "company";
  contract_id: string | null;
  company_category: string | null;
};

const PAGE_SIZE = 100;
// Jedno wywołanie Vercel uzupełnia ograniczoną partię XML. Dzięki temu duży
// miesiąc nie blokuje zapisu metadanych ani nie wpada w limit 300 sekund.
// 28 dokumentów przy 4 workerach oznacza maksymalnie 7 odczytów na workera.
const XML_DETAILS_PER_BATCH = 28;
const XML_WORKER_COUNT = 4;
const XML_DOWNLOAD_TIMEOUT_MS = 25_000;

class KsefXmlTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KsefXmlTimeoutError";
  }
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    return response.status(405).json({ error: "Metoda niedozwolona." });
  }

  let environment: KsefEnvironment = "demo";
  try {
    const token = authorizationToken(request.headers.authorization);
    if (!token) return response.status(401).json({ error: "Brak sesji użytkownika." });

    const importRequest = readImportRequest(request.body);
    const { month, ksefNumbers, invoiceType } = importRequest;
    environment = importRequest.environment;
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
    if (environment === "production" && profile.role !== "owner") {
      return response.status(403).json({ error: "Import z KSeF PRODUKCJA może uruchomić wyłącznie właściciel." });
    }
    if (environment === "production" && process.env.KSEF_PROD_IMPORT_ENABLED !== "true") {
      return response.status(403).json({ error: "Import z KSeF PRODUKCJA jest jeszcze zablokowany. Najpierw potwierdź test połączenia, a następnie włącz sekret KSEF_PROD_IMPORT_ENABLED=true w Vercel." });
    }

    const { data: assignmentRuleRows, error: assignmentRulesError } = await callerClient
      .from("invoice_assignment_rules")
      .select("active, priority, invoice_type, match_nip, match_text, target_type, contract_id, company_category")
      .eq("active", true)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true });
    if (assignmentRulesError) throw assignmentRulesError;
    const assignmentRules = (assignmentRuleRows || []) as AssignmentRule[];

    const credentials = credentialsFor(environment);
    const client = new KSeFClient({ environment: credentials.clientEnvironment });
    await client.loginWithCertificate(credentials.certificatePem, credentials.privateKeyPem, credentials.nip);

    const { from, to } = monthRange(month);
    const [sales, purchases] = await Promise.all([
      invoiceType === "purchase" ? Promise.resolve(null) : client.invoices.queryInvoiceMetadata(new InvoiceQueryFilterBuilder().withSubjectType("Subject1").withDateRange("Issue", from, to).build(), 0, PAGE_SIZE, "Desc"),
      invoiceType === "sales" ? Promise.resolve(null) : client.invoices.queryInvoiceMetadata(new InvoiceQueryFilterBuilder().withSubjectType("Subject2").withDateRange("Issue", from, to).build(), 0, PAGE_SIZE, "Desc"),
    ]);

    const importAllForMonth = ksefNumbers.length === 0;
    const requested = new Set(ksefNumbers);
    const current = new Map<string, InvoiceToImport>();
    for (const invoice of sales?.invoices || []) {
      if (importAllForMonth || requested.has(invoice.ksefNumber)) current.set(invoice.ksefNumber, { invoice, type: "sales" });
    }
    for (const invoice of purchases?.invoices || []) {
      if (importAllForMonth || requested.has(invoice.ksefNumber)) current.set(invoice.ksefNumber, { invoice, type: "purchase" });
    }

    const foundNumbers = [...current.keys()];
    const missingCount = importAllForMonth ? 0 : ksefNumbers.length - foundNumbers.length;
    if (!foundNumbers.length) {
      return response.status(200).json({
        imported: 0,
        skipped: 0,
        message: `${ksefLabel(environment)} nie zwrócił ${invoiceTypeLabel(invoiceType)} do importu w wybranym miesiącu.`,
      });
    }

    const { data: existingRows, error: existingError } = await callerClient
      .from("invoices")
      .select("id, ksef_number, due_date, ksef_details_synced_at")
      .in("ksef_number", foundNumbers)
      .eq("ksef_environment", environment);
    if (existingError) throw existingError;

    const existingByKsefNumber = new Map(
      ((existingRows || []) as ExistingInvoice[])
        .filter((row) => Boolean(row.ksef_number))
        .map((row) => [row.ksef_number as string, row]),
    );

    // Metadane KSeF nie zawierają terminu płatności ani opisu pozycji. XML
    // pobieramy w małych, równoległych partiach; reszta jest dokończona przez
    // kolejne krótkie wywołanie z przeglądarki, bez ryzyka timeoutu Vercel.
    const detailCandidates = [...current.values()].filter(({ invoice }) => {
      const saved = existingByKsefNumber.get(invoice.ksefNumber);
      return !saved || !saved.ksef_details_synced_at;
    });
    const dueDateResult = await loadDueDates(
      client,
      detailCandidates.slice(0, XML_DETAILS_PER_BATCH),
    );
    const dueDates = dueDateResult.values;
    const itemSummaries = dueDateResult.itemSummaries;
    const detailsSyncedAt = new Date().toISOString();

    const toInsert = [...current.values()]
      .filter(({ invoice }) => !existingByKsefNumber.has(invoice.ksefNumber))
      .map(({ invoice, type }) => invoicePayload(
        invoice,
        type,
        caller.user.id,
        dueDates.get(invoice.ksefNumber) || null,
        itemSummaries.get(invoice.ksefNumber) || "",
        matchingRule(invoice, type, itemSummaries.get(invoice.ksefNumber) || "", assignmentRules),
        environment,
        dueDateResult.synchronized.has(invoice.ksefNumber) ? detailsSyncedAt : null,
      ));

    if (toInsert.length) {
      const { error: insertError } = await callerClient
        .from("invoices")
        .upsert(toInsert, { onConflict: "ksef_number,ksef_environment", ignoreDuplicates: true });
      if (insertError) throw insertError;
    }

    let dueDatesUpdated = 0;
    for (const saved of existingByKsefNumber.values()) {
      if (!saved.ksef_number || !dueDateResult.synchronized.has(saved.ksef_number)) continue;
      const dueDate = !saved.due_date ? dueDates.get(saved.ksef_number) : null;
      const itemSummary = itemSummaries.get(saved.ksef_number);
      const updatePayload: Record<string, string> = { ksef_details_synced_at: detailsSyncedAt };
      if (dueDate) updatePayload.due_date = dueDate;
      if (itemSummary) updatePayload.ksef_item_summary = itemSummary;
      const { error: updateError } = await callerClient
        .from("invoices")
        .update(updatePayload)
        .eq("id", saved.id);
      if (updateError) throw updateError;
      if (dueDate) dueDatesUpdated += 1;
    }

    const skipped = existingByKsefNumber.size + missingCount;
    const automaticallyAssigned = toInsert.filter((row) => row.allocation !== "unassigned").length;
    const skippedMessage = missingCount
      ? `; pominięto ${skipped} już zapisanych lub niedostępnych pozycji`
      : existingByKsefNumber.size ? `; pominięto ${existingByKsefNumber.size} już zapisanych pozycji` : "";
    const dueDateMessage = dueDatesUpdated ? ` Uzupełniono termin płatności w ${dueDatesUpdated} zapisanych pozycjach.` : "";
    const failedDetails = Math.max(0, dueDateResult.failures - dueDateResult.timeouts);
    const dueDateWarning = failedDetails
      ? ` Nie udało się odczytać terminu płatności dla ${failedDetails} faktur; spróbuj ponownie po sprawdzeniu logów Vercel.`
      : "";
    const timeoutWarning = dueDateResult.timeouts
      ? ` KSeF nie odpowiedział na czas dla ${dueDateResult.timeouts} faktur; ich szczegóły zostaną ponowione przy następnym imporcie.`
      : "";
    const detailsPending = Math.max(0, detailCandidates.length - dueDateResult.synchronized.size);
    const detailsMessage = detailCandidates.length
      ? ` Odczytano dodatkowe dane XML dla ${dueDateResult.synchronized.size} z ${detailCandidates.length} faktur.${detailsPending ? ` Pozostało ${detailsPending} do krótkiego uzupełnienia.` : ""}`
      : "";
    return response.status(200).json({
      imported: toInsert.length,
      skipped,
      dueDatesUpdated,
      detailsSynced: dueDateResult.synchronized.size,
      detailsPending,
      message: `Zaimportowano ${toInsert.length} (${invoiceTypeLabel(invoiceType)}) do rejestru PrądPlan${skippedMessage}.${automaticallyAssigned ? ` Automatycznie przypisano ${automaticallyAssigned} faktur według reguł.` : ""}${dueDateMessage}${detailsMessage}${dueDateWarning}${timeoutWarning}`,
    });
  } catch (error) {
    const diagnostic = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "UnknownError";
    console.error(`${ksefLabel(environment)} invoice import failed`, diagnostic);
    return response.status(422).json({
      error: `Nie udało się zaimportować wybranych faktur z ${ksefLabel(environment)}. Sprawdź logi funkcji Vercel.`,
    });
  }
}

function invoicePayload(
  invoice: KsefInvoice,
  type: "sales" | "purchase",
  userId: string,
  dueDate: string | null,
  itemSummary: string,
  rule: AssignmentRule | null,
  environment: KsefEnvironment,
  detailsSyncedAt: string | null,
) {
  const netAmount = numberToCents(invoice.netAmount, "kwotę netto");
  const vatAmount = numberToCents(invoice.vatAmount, "kwotę VAT");
  const effectiveVatRate = netAmount !== 0 ? Math.round((vatAmount / netAmount) * 10000) / 100 : 0;
  if (effectiveVatRate < 0 || effectiveVatRate > 100) throw new Error("Nieprawidłowa stawka VAT zwrócona przez KSeF.");
  const counterparty = type === "sales"
    ? invoice.buyer.name || invoice.buyer.identifier.value || "Brak danych kontrahenta"
    : invoice.seller.name || invoice.seller.nip || "Brak danych kontrahenta";
  const counterpartyNip = type === "sales" ? invoice.buyer.identifier.value || null : invoice.seller.nip || null;

  return {
    invoice_type: type,
    source: "ksef",
    ksef_environment: environment,
    document_number: invoice.invoiceNumber || invoice.ksefNumber,
    ksef_number: invoice.ksefNumber,
    counterparty,
    counterparty_nip: counterpartyNip,
    ksef_item_summary: itemSummary,
    ksef_details_synced_at: detailsSyncedAt,
    issue_date: invoice.issueDate.slice(0, 10),
    due_date: dueDate,
    net_amount_cents: netAmount,
    vat_rate: effectiveVatRate,
    allocation: rule?.target_type || "unassigned",
    contract_id: rule?.target_type === "contract" ? rule.contract_id : null,
    company_category: rule?.target_type === "company" ? rule.company_category : null,
    payment_status: "nowa",
    created_by: userId,
    ksef_imported_at: new Date().toISOString(),
  };
}

async function loadDueDates(client: KSeFClient, invoices: InvoiceToImport[]) {
  const values = new Map<string, string>();
  const itemSummaries = new Map<string, string>();
  const synchronized = new Set<string>();
  let failures = 0;
  let timeouts = 0;
  // Cztery równoległe pobrania są wystarczająco ostrożne dla KSeF, a skracają
  // odczyt XML wielokrotnie względem pojedynczej kolejki.
  const workerCount = Math.min(XML_WORKER_COUNT, invoices.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < invoices.length) {
      const item = invoices[nextIndex++];
      try {
        const xml = await downloadInvoiceXml(client, item.invoice.ksefNumber);
        const dueDate = paymentDueDateFromXml(xml);
        if (dueDate) values.set(item.invoice.ksefNumber, dueDate);
        const itemSummary = invoiceItemSummaryFromXml(xml);
        if (itemSummary) itemSummaries.set(item.invoice.ksefNumber, itemSummary);
        synchronized.add(item.invoice.ksefNumber);
      } catch (error) {
        failures += 1;
        const diagnostic = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "UnknownError";
        console.warn("KSeF payment due date skipped", item.invoice.ksefNumber, diagnostic);
        // Nie dokładamy kolejnych nieprzerwanych zapytań do tego samego
        // workera. Pozostałe dokumenty zostaną dokończone przy kolejnym,
        // krótkim wywołaniu importu.
        if (error instanceof KsefXmlTimeoutError) {
          timeouts += 1;
          return;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return { values, itemSummaries, synchronized, failures, timeouts };
}

function matchingRule(invoice: KsefInvoice, type: "sales" | "purchase", itemSummary: string, rules: AssignmentRule[]) {
  const counterparty = type === "sales"
    ? invoice.buyer.name || invoice.buyer.identifier.value || ""
    : invoice.seller.name || invoice.seller.nip || "";
  const nip = normalizeNip(type === "sales" ? invoice.buyer.identifier.value || "" : invoice.seller.nip || "");
  const searchable = normalizeMatchText([counterparty, invoice.invoiceNumber, itemSummary].join(" "));
  return rules.find((rule) => {
    if (!rule.active || (rule.invoice_type && rule.invoice_type !== type)) return false;
    // FV sprzedażowe są przychodem kontraktowym — nigdy nie kierujemy ich
    // automatycznie do kategorii kosztów firmowych.
    if (type === "sales" && rule.target_type !== "contract") return false;
    const nipMatches = !rule.match_nip || normalizeNip(rule.match_nip) === nip;
    const text = normalizeMatchText(rule.match_text || "");
    const textMatches = !text || searchable.includes(text);
    return nipMatches && textMatches;
  }) || null;
}

function invoiceItemSummaryFromXml(xml: string) {
  const invoice = firstTagContent(xml, "Fa") || xml;
  return [...new Set(tagContents(invoice, "P_7").map((value) => decodeXml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())).filter(Boolean))]
    .join(" · ")
    .slice(0, 800);
}

function normalizeNip(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeMatchText(value: string) {
  return String(value || "").toLocaleLowerCase("pl-PL").replace(/\s+/g, " ").trim();
}

async function downloadInvoiceXml(client: KSeFClient, ksefNumber: string) {
  // Dokument pobiera i odszyfrowuje wyłącznie serwer. Rzutowanie zachowuje
  // zgodność z deklaracjami wersji 0.13 klienta KSeF użytej w tym projekcie.
  const invoices = client.invoices as unknown as { getInvoice: (number: string) => Promise<unknown> };
  if (typeof invoices.getInvoice !== "function") {
    throw new Error("Zainstalowana wersja klienta KSeF nie obsługuje pobierania XML faktury.");
  }
  // KSeF potrafi sporadycznie nie zwrócić XML-a. Bez lokalnego limitu jedna
  // zawieszona faktura blokowała całą funkcję aż do twardego limitu Vercel
  // (300 s), mimo że pozostałe dokumenty były gotowe do zapisu.
  const result = await withTimeout(
    invoices.getInvoice(ksefNumber),
    XML_DOWNLOAD_TIMEOUT_MS,
    `KSeF nie odpowiedział w ciągu ${Math.round(XML_DOWNLOAD_TIMEOUT_MS / 1000)} s podczas pobierania XML faktury ${ksefNumber}.`,
  );
  return xmlTextFromResult(result);
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new KsefXmlTimeoutError(message)), timeoutMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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

function numberToCents(value: unknown, label: string) {
  // Korekty z KSeF mogą mieć ujemną wartość netto i VAT. Nie wolno ich
  // odrzucać — w podsumowaniach powinny pomniejszać wartość dokumentów.
  const normalized = typeof value === "string"
    ? value.trim().replace(/\s+/g, "").replace(",", ".")
    : value;
  const amount = typeof normalized === "number" ? normalized : Number(normalized);
  if (normalized === "" || normalized === null || normalized === undefined || !Number.isFinite(amount)) {
    const receivedType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    throw new Error(`KSeF zwrócił nieprawidłową ${label} (format: ${receivedType}).`);
  }
  return Math.round(amount * 100);
}

function readImportRequest(body: unknown) {
  const payload = typeof body === "string" ? JSON.parse(body) : body;
  const requestedEnvironment = typeof (payload as { environment?: unknown } | null)?.environment === "string"
    ? (payload as { environment: string }).environment.trim().toLowerCase()
    : "demo";
  if (requestedEnvironment !== "demo" && requestedEnvironment !== "production") {
    throw new Error("Nieprawidłowe środowisko KSeF.");
  }
  const month = typeof (payload as { month?: unknown } | null)?.month === "string"
    ? (payload as { month: string }).month
    : "";
  const rawNumbers = Array.isArray((payload as { ksefNumbers?: unknown[] } | null)?.ksefNumbers)
    ? (payload as { ksefNumbers: unknown[] }).ksefNumbers
    : [];
  const ksefNumbers = [...new Set(rawNumbers.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Nieprawidłowy miesiąc importu.");
  if (ksefNumbers.length > PAGE_SIZE * 2) throw new Error("Można przekazać maksymalnie 200 faktur do importu.");
  const requestedType = typeof (payload as { invoiceType?: unknown } | null)?.invoiceType === "string"
    ? (payload as { invoiceType: string }).invoiceType.trim()
    : "all";
  if (!["all", "sales", "purchase"].includes(requestedType)) throw new Error("Nieprawidłowy rodzaj faktur do importu.");
  return {
    month,
    ksefNumbers,
    invoiceType: requestedType as "all" | "sales" | "purchase",
    environment: requestedEnvironment as KsefEnvironment,
  };
}

function invoiceTypeLabel(type: "all" | "sales" | "purchase") {
  return type === "sales" ? "FV sprzedażowych" : type === "purchase" ? "FV zakupowych" : "FV zakupowych i sprzedażowych";
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
