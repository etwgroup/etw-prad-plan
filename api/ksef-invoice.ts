// PrądPlan / wizualizacja pojedynczej faktury KSeF DEMO.
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
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    return response.status(405).json({ error: "Metoda niedozwolona." });
  }

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
      .select("id, ksef_number")
      .eq("id", invoiceId)
      .single();
    if (invoiceError || !(savedInvoice as SavedInvoice | null)?.ksef_number) {
      return response.status(404).json({ error: "Nie znaleziono zaimportowanej faktury KSeF." });
    }

    const certificatePem = certificateToPem(requiredEnvironment("KSEF_DEMO_CERTIFICATE_BASE64"));
    const privateKeyPem = privateKeyToPem(
      requiredEnvironment("KSEF_DEMO_PRIVATE_KEY_BASE64"),
      process.env.KSEF_DEMO_PRIVATE_KEY_PASSWORD || "",
    );
    const client = new KSeFClient({ environment: "DEMO" });
    await client.loginWithCertificate(certificatePem, privateKeyPem, requiredEnvironment("KSEF_DEMO_NIP"));

    const invoice = savedInvoice as SavedInvoice;
    const xml = await downloadInvoiceXml(client, invoice.ksef_number as string);
    return response.status(200).json({ invoice: visualizationFromXml(xml, invoice.ksef_number as string) });
  } catch (error) {
    const diagnostic = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "UnknownError";
    console.error("KSeF DEMO invoice visualization failed", diagnostic);
    return response.status(422).json({
      error: "Nie udało się pobrać wizualizacji faktury z KSeF DEMO. Sprawdź logi funkcji Vercel.",
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

async function downloadInvoiceXml(client: KSeFClient, ksefNumber: string) {
  // Deklaracje używanej wersji 0.13 nie eksportują jeszcze tej metody, choć
  // klient ją udostępnia. Dokument nigdy nie jest wysyłany do przeglądarki.
  const invoices = client.invoices as unknown as { getInvoice: (number: string) => Promise<string | Uint8Array> };
  if (typeof invoices.getInvoice !== "function") {
    throw new Error("Zainstalowana wersja klienta KSeF nie obsługuje pobierania XML faktury.");
  }
  const result = await invoices.getInvoice(ksefNumber);
  return typeof result === "string" ? result : Buffer.from(result).toString("utf8");
}

function visualizationFromXml(xml: string, ksefNumber: string) {
  const invoice = firstTagContent(xml, "Fa") || xml;
  const payment = firstTagContent(invoice, "Platnosc");
  const seller = firstTagContent(invoice, "Podmiot1");
  const buyer = firstTagContent(invoice, "Podmiot2");
  const items = tagContents(invoice, "FaWiersz").map((row) => ({
    name: firstTagText(row, "P_7") || "Pozycja faktury",
    quantity: firstTagText(row, "P_8B") || firstTagText(row, "P_8A") || "",
    unit: firstTagText(row, "P_8A") || "",
    netAmount: toNumber(firstTagText(row, "P_11")),
    vatRate: firstTagText(row, "P_12") || "",
  }));
  const itemsNet = items.reduce((total, item) => total + (item.netAmount || 0), 0);
  const declaredNet = totalFromTags(invoice, "P_13");

  return {
    ksefNumber,
    number: firstTagText(invoice, "P_2") || "—",
    issueDate: dateOnly(firstTagText(invoice, "P_1")),
    dueDate: paymentDueDateFromXml(invoice),
    currency: firstTagText(invoice, "KodWaluty") || "PLN",
    kind: firstTagText(invoice, "RodzajFaktury") || "Faktura VAT",
    seller: partyFromXml(seller),
    buyer: partyFromXml(buyer),
    payment: {
      form: firstTagText(payment, "FormaPlatnosci"),
      account: firstTagText(payment, "NrRB"),
    },
    items,
    totals: {
      netAmount: declaredNet ?? (items.length ? itemsNet : null),
      grossAmount: toNumber(firstTagText(invoice, "P_15")),
    },
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
