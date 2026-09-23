// PrądPlan / wizualizacja pojedynczej faktury KSeF (DEMO albo PRODUKCJA).
// XML faktury jest pobierany, odszyfrowywany i przetwarzany wyłącznie na
// serwerze. Do przeglądarki trafia tylko ograniczony zestaw danych potrzebny
// do pokazania dokumentu.
import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import { createPrivateKey } from "node:crypto";
import { KSeFClient } from "ksef-client-ts";

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

type SavedInvoice = {
  id: string;
  ksef_number: string | null;
  ksef_environment: "demo" | "production" | null;
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    return response.status(405).json({ error: "Metoda niedozwolona." });
  }

  let environment: "demo" | "production" = "demo";
  try {
    const token = authorizationToken(request.headers.authorization);
    if (!token) return response.status(401).json({ error: "Brak sesji użytkownika." });

    const invoiceId = readInvoiceId(request.body);
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
      return response.status(403).json({ error: "Brak uprawnień do podglądu faktury KSeF." });
    }

    const { data: savedInvoice, error: invoiceError } = await callerClient
      .from("invoices")
      .select("id, ksef_number, ksef_environment")
      .eq("id", invoiceId)
      .single();
    const invoice = savedInvoice as SavedInvoice | null;
    if (invoiceError || !invoice?.ksef_number || !["demo", "production"].includes(invoice.ksef_environment || "")) {
      return response.status(404).json({ error: "Nie znaleziono zaimportowanej faktury KSeF." });
    }
    environment = invoice.ksef_environment as "demo" | "production";
    if (environment === "production" && profile.role !== "owner") {
      return response.status(403).json({ error: "Podgląd faktury z KSeF PRODUKCJA jest dostępny wyłącznie dla właściciela." });
    }

    const credentials = credentialsFor(environment);
    const client = new KSeFClient({ environment: credentials.clientEnvironment });
    await client.loginWithCertificate(credentials.certificatePem, credentials.privateKeyPem, credentials.nip);

    const xml = await downloadInvoiceXml(client, invoice.ksef_number as string);
    return response.status(200).json({
      environment,
      invoice: visualizationFromXml(xml, invoice.ksef_number as string),
    });
  } catch (error) {
    const diagnostic = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "UnknownError";
    console.error(`${ksefLabel(environment)} invoice visualization failed`, diagnostic);
    return response.status(422).json({
      error: `Nie udało się pobrać wizualizacji faktury z ${ksefLabel(environment)}. Sprawdź logi funkcji Vercel.`,
    });
  }
}

function readInvoiceId(body: unknown) {
  const payload = typeof body === "string" ? JSON.parse(body) : body;
  const invoiceId = typeof (payload as { invoiceId?: unknown } | null)?.invoiceId === "string"
    ? (payload as { invoiceId: string }).invoiceId.trim()
    : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)) {
    throw new Error("Nieprawidłowy identyfikator faktury.");
  }
  return invoiceId;
}

function credentialsFor(environment: "demo" | "production") {
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

function ksefLabel(environment: "demo" | "production") {
  return environment === "production" ? "KSeF PRODUKCJA" : "KSeF DEMO";
}

async function downloadInvoiceXml(client: KSeFClient, ksefNumber: string) {
  // Deklaracje używanej wersji 0.13 nie eksportują jeszcze tej metody, choć
  // klient ją udostępnia. Dokument nigdy nie jest wysyłany do przeglądarki.
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

function visualizationFromXml(xml: string, ksefNumber: string) {
  const invoice = firstTagContent(xml, "Fa") || xml;
  const payment = firstTagContent(invoice, "Platnosc");
  // Podmioty znajdują się bezpośrednio w Faktura, obok bloku Fa z pozycjami.
  const seller = firstTagContent(xml, "Podmiot1");
  const buyer = firstTagContent(xml, "Podmiot2");
  const recipient = firstTagContent(xml, "Podmiot3");
  const items = tagContents(invoice, "FaWiersz").map((row) => invoiceItemFromXml(row));
  const itemsNet = items.reduce((total, item) => total + (item.netAmount || 0), 0);
  const declaredNet = totalFromTags(invoice, "P_13");
  const grossAmount = toNumber(firstTagText(invoice, "P_15"));
  const netAmount = declaredNet ?? (items.length ? itemsNet : null);
  const declaredVat = totalFromTags(invoice, "P_14");

  return {
    ksefNumber,
    number: firstTagText(invoice, "P_2") || "—",
    issueDate: dateOnly(firstTagText(invoice, "P_1")),
    dueDate: paymentDueDateFromXml(invoice),
    currency: firstTagText(invoice, "KodWaluty") || "PLN",
    kind: firstTagText(invoice, "RodzajFaktury") || "Faktura VAT",
    seller: partyFromXml(seller),
    buyer: partyFromXml(buyer),
    recipient: partyFromXml(recipient),
    payment: {
      form: firstTagText(payment, "FormaPlatnosci"),
      otherDescription: firstTagText(payment, "OpisPlatnosci"),
      account: firstTagText(payment, "NrRB"),
    },
    items,
    totals: {
      netAmount,
      vatAmount: declaredVat ?? (netAmount !== null && grossAmount !== null ? roundMoney(grossAmount - netAmount) : null),
      grossAmount,
    },
  };
}

function invoiceItemFromXml(xml: string) {
  const netAmount = toNumber(firstTagText(xml, "P_11"));
  const vatRate = firstTagText(xml, "P_12") || "";
  const rate = toNumber(vatRate);
  const vatAmount = netAmount !== null && rate !== null ? roundMoney(netAmount * rate / 100) : null;
  return {
    name: firstTagText(xml, "P_7") || "Pozycja faktury",
    // W strukturze FA P_8A oznacza ilość, a P_8B jednostkę miary.
    // Dodatkowe nazwy są bezpiecznym fallbackiem dla wariantów XML.
    quantity: firstTagText(xml, "P_8A") || firstTagText(xml, "Ilosc") || firstTagText(xml, "IloscTowaru") || "",
    unit: firstTagText(xml, "P_8B") || firstTagText(xml, "JednostkaMiary") || firstTagText(xml, "Miara") || "",
    netAmount,
    vatRate,
    vatAmount,
    grossAmount: netAmount !== null && vatAmount !== null ? roundMoney(netAmount + vatAmount) : null,
  };
}

function partyFromXml(xml: string) {
  return {
    name: firstTagText(xml, "Nazwa") || "—",
    nip: firstTagText(xml, "NIP"),
    address: [firstTagText(xml, "AdresL1"), firstTagText(xml, "AdresL2")].filter(Boolean).join(", "),
  };
}

function paymentDueDateFromXml(xml: string) {
  const payment = firstTagContent(xml, "Platnosc");
  for (const term of tagContents(payment, "TerminPlatnosci")) {
    const date = dateOnly(firstTagText(term, "Termin"));
    if (date) return date;
  }
  return "";
}

function totalFromTags(xml: string, prefix: string) {
  let total = 0;
  let found = false;
  const direct = toNumber(firstTagText(xml, prefix));
  if (direct !== null) {
    total += direct;
    found = true;
  }
  for (let index = 1; index <= 20; index += 1) {
    const value = toNumber(firstTagText(xml, `${prefix}_${index}`));
    if (value !== null) {
      total += value;
      found = true;
    }
  }
  return found ? total : null;
}

function toNumber(value: string) {
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateOnly(value: string) {
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
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
