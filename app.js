import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.ETW_CONFIG || {};
const supabaseUrl = normalizeSupabaseUrl(config.supabaseUrl);
const app = document.querySelector("#app");
const modal = document.querySelector("#entry-modal");
const modalTitle = document.querySelector("#modal-title");
const modalEyebrow = document.querySelector("#modal-eyebrow");
const modalFields = document.querySelector("#modal-fields");
const formError = document.querySelector("#form-error");
const entryForm = document.querySelector("#entry-form");

const viewMeta = {
  dashboard: { label: "Przegląd", icon: "▦" },
  contracts: { label: "Portfel kontraktów", icon: "▦" },
  settlements: { label: "Rozliczenia", icon: "▤" },
  invoices: { label: "Faktury", icon: "▧" },
  costs: { label: "Koszty firmowe", icon: "▱" },
};

const state = {
  activeView: "dashboard",
  user: null,
  profile: null,
  contracts: [],
  settlements: [],
  invoices: [],
  costs: [],
  modalMode: null,
  supabase: null,
  shellEventsBound: false,
};

if (!supabaseUrl || !config.supabasePublishableKey) {
  renderSetup();
} else {
  const supabase = createClient(supabaseUrl, config.supabasePublishableKey);
  start(supabase);
}

function renderSetup() {
  app.innerHTML = `
    <section class="setup-screen">
      <p class="eyebrow">PRĄDPLAN / KONFIGURACJA</p>
      <h1>Uzupełnij config.js</h1>
      <p>Wpisz adres projektu Supabase oraz jego klucz Publishable (lub anon), a następnie odśwież stronę.</p>
      <div class="notice">Adres musi mieć postać <strong>https://identyfikator-projektu.supabase.co</strong>. Nie używaj adresu panelu Supabase ani końcówki <strong>/rest/v1</strong>.</div>
      <div class="notice">Nie wklejaj tutaj klucza <strong>service_role</strong>. Ten klucz pozostaje wyłącznie po stronie serwera.</div>
    </section>`;
}

async function start(supabase) {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await boot(supabase, session.user);
  else renderAuth(supabase);

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) await boot(supabase, session.user);
    else renderAuth(supabase);
  });
}

function renderAuth(supabase) {
  state.user = null;
  state.profile = null;
  app.innerHTML = `
    <section class="auth-screen">
      <section class="auth-hero" aria-label="PrądPlan — ETW Group">
        <div class="auth-hero-inner">
          <div class="auth-brand-lockup">
            <img class="auth-etw-logo" src="https://etwgroup.pl/wp-content/uploads/2024/10/ETW-logo.png" alt="ETW Group" width="142" height="85" />
            <i></i>
            <strong class="auth-brand-product">PRĄDPLAN</strong>
          </div>
          <p class="auth-kicker">PANEL KONTRAKTÓW</p>
          <h1>Kontrakty<br />pod kontrolą.</h1>
          <p class="auth-intro">Prowadź kontrakty elektryczne i teletechniczne. Rozliczenia, faktury oraz koszty firmowe są zawsze w jednym miejscu.</p>
          <div class="auth-features">
            <p><b>✓</b> Kontroluj wartość, termin i postęp kontraktów</p>
            <p><b>✓</b> Przypisuj rozliczenia i faktury do kontraktów</p>
            <p><b>✓</b> Prowadź koszty firmowe oraz cash flow</p>
          </div>
          <p class="auth-footer">ETW Group · wewnętrzny system prowadzenia kontraktów</p>
        </div>
      </section>
      <section class="auth-form-area">
        <form class="auth-card" id="login-form">
          <p class="eyebrow">BEZPIECZNE LOGOWANIE</p>
          <h2>Zaloguj się</h2>
          <p class="auth-form-intro">Użyj firmowego adresu e-mail i hasła ustawionego po otrzymaniu zaproszenia.</p>
          <label>Adres e-mail<input type="email" name="email" autocomplete="email" required /></label>
          <label>Hasło<input type="password" name="password" autocomplete="current-password" required /></label>
          <p class="form-error" id="login-error" hidden></p>
          <button class="button button-primary" type="submit">Zaloguj się <span aria-hidden="true">→</span></button>
          <p class="auth-help">Nie masz konta? Poproś właściciela o jego utworzenie.</p>
        </form>
      </section>
    </section>`;

  const form = document.querySelector("#login-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorBox = document.querySelector("#login-error");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Logowanie…";
    errorBox.hidden = true;
    const credentials = new FormData(form);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(credentials.get("email") || ""),
      password: String(credentials.get("password") || ""),
    });
    if (error) {
      errorBox.textContent = "Nie udało się zalogować: " + error.message;
      errorBox.hidden = false;
      button.disabled = false;
      button.innerHTML = `Zaloguj się <span aria-hidden="true">→</span>`;
    }
  });
}

async function boot(supabase, user) {
  state.supabase = supabase;
  state.user = user;
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, active")
    .eq("id", user.id)
    .single();

  if (error) {
    app.innerHTML = `<section class="setup-screen"><p class="eyebrow">DOSTĘP</p><h1>Profil użytkownika nie jest gotowy</h1><p>Utwórz użytkownika po uruchomieniu migracji 001, a następnie zaloguj się ponownie.</p><div class="notice">${escapeHtml(error.message)}</div></section>`;
    return;
  }

  if (!profile.active) {
    app.innerHTML = `<section class="setup-screen"><p class="eyebrow">DOSTĘP OCZEKUJE</p><h1>Konto oczekuje na aktywację</h1><p>Administrator PrądPlan musi aktywować konto i nadać mu rolę w Supabase.</p><div class="notice">Po aktywacji odśwież stronę lub zaloguj się ponownie.</div></section>`;
    return;
  }

  state.profile = profile;
  renderShell(supabase);
  await loadView(supabase);
}

function renderShell(supabase) {
  app.innerHTML = `
    <div class="app-layout">
      <aside class="sidebar">
        <div class="brand-lockup">
          <div class="brand-mark">ETW</div>
          <div><strong>PrądPlan</strong><span>KONTRAKTY</span></div>
        </div>
        <p class="nav-label">PROWADZENIE</p>
        <nav class="nav" aria-label="Główne menu">
          ${navButton("dashboard")}
          ${navButton("contracts")}
          ${navButton("settlements")}
          ${navButton("invoices")}
          ${navButton("costs")}
        </nav>
        <div class="sidebar-footer">
          <div>ETW Group / PrądPlan</div>
          <div class="user-email">${escapeHtml(state.profile.email || state.user.email || "")}</div>
          <div>Rola: ${escapeHtml(roleLabel(state.profile.role))}</div>
        </div>
      </aside>
      <section class="workspace">
        <header class="topbar">
          <div class="breadcrumb">ETW Group <span>/</span> <strong id="breadcrumb-view">Przegląd</strong></div>
          <div class="topbar-actions">
            <span class="status"><i class="status-dot"></i>Baza aktywna</span>
            <button class="logout" id="logout-button" type="button">Wyloguj</button>
          </div>
        </header>
        <div class="content" id="page-content"></div>
      </section>
    </div>`;

  if (!state.shellEventsBound) {
    app.addEventListener("click", async (event) => {
      const nav = event.target.closest("[data-view]");
      if (nav) {
        state.activeView = nav.dataset.view;
        renderShell(state.supabase);
        await loadView(state.supabase);
        return;
      }
      const add = event.target.closest("[data-add]");
      if (add) openEntryModal(add.dataset.add);
      if (event.target.closest("#logout-button")) await state.supabase.auth.signOut();
    });
    state.shellEventsBound = true;
  }
}

function navButton(view) {
  const meta = viewMeta[view];
  return `<button type="button" class="nav-button ${view === state.activeView ? "is-active" : ""}" data-view="${view}"><span class="nav-icon">${meta.icon}</span>${meta.label}</button>`;
}

async function loadView(supabase) {
  const page = document.querySelector("#page-content");
  const crumb = document.querySelector("#breadcrumb-view");
  if (!page || !crumb) return;
  crumb.textContent = viewMeta[state.activeView].label;
  page.innerHTML = `<section class="panel"><div class="empty">Pobieranie danych…</div></section>`;

  try {
    if (state.activeView === "dashboard") {
      await loadDashboardData(supabase);
      page.innerHTML = renderDashboard();
    }
    if (state.activeView === "contracts") {
      state.contracts = await selectRows(supabase, "contracts", "id, name, client, trade, value_cents, budget_cents, baseline_progress, due_date, status", "created_at", false);
      page.innerHTML = renderContracts();
    }
    if (state.activeView === "settlements") {
      await loadSettlementData(supabase);
      page.innerHTML = renderSettlements();
    }
    if (state.activeView === "invoices") {
      await loadInvoiceData(supabase);
      page.innerHTML = renderInvoices();
    }
    if (state.activeView === "costs") {
      state.costs = await selectRows(supabase, "company_costs", "id, cost_date, category, description, vendor, document_number, net_amount_cents, vat_rate, payment_status", "cost_date", false);
      page.innerHTML = renderCosts();
    }
  } catch (error) {
    page.innerHTML = `<section class="panel"><div class="empty">Nie udało się pobrać danych: ${escapeHtml(error.message || "nieznany błąd")}</div></section>`;
  }
}

async function loadDashboardData(supabase) {
  const [contracts, settlements, invoices, costs] = await Promise.all([
    selectRows(supabase, "contracts", "id, name, value_cents, baseline_progress, status", "created_at", false),
    selectRows(supabase, "settlements", "id, kind, net_amount_cents", "settlement_date", false),
    selectRows(supabase, "invoices", "id, invoice_type, net_amount_cents, allocation", "issue_date", false),
    selectRows(supabase, "company_costs", "id, net_amount_cents", "cost_date", false),
  ]);
  state.contracts = contracts;
  state.settlements = settlements;
  state.invoices = invoices;
  state.costs = costs;
}

async function loadSettlementData(supabase) {
  const [contracts, settlements] = await Promise.all([
    selectRows(supabase, "contracts", "id, name", "name", true),
    selectRows(supabase, "settlements", "id, contract_id, period, settlement_date, kind, net_amount_cents, vat_rate, reference_number, budget_category, status, contracts(name)", "settlement_date", false),
  ]);
  state.contracts = contracts;
  state.settlements = settlements;
}

async function loadInvoiceData(supabase) {
  const [contracts, invoices] = await Promise.all([
    selectRows(supabase, "contracts", "id, name", "name", true),
    selectRows(supabase, "invoices", "id, invoice_type, source, document_number, ksef_number, counterparty, issue_date, due_date, net_amount_cents, vat_rate, allocation, contract_id, company_category, payment_status, contracts(name)", "issue_date", false),
  ]);
  state.contracts = contracts;
  state.invoices = invoices;
}

async function selectRows(supabase, table, columns, orderColumn, ascending) {
  const { data, error } = await supabase.from(table).select(columns).order(orderColumn, { ascending });
  if (error) throw error;
  return data || [];
}

function renderDashboard() {
  const contractValue = sum(state.contracts, "value_cents");
  const settlements = sum(state.settlements, "net_amount_cents");
  const companyCosts = sum(state.costs, "net_amount_cents");
  const unassigned = state.invoices.filter((invoice) => invoice.allocation === "unassigned");
  return `
    ${heading("PRĄDPLAN / PRZEGLĄD", "Portfel kontraktów", "Jedno miejsce do kontroli kontraktów, rozliczeń, faktur i kosztów firmowych.")}
    <section class="metric-grid">
      ${metric("Kontrakty aktywne", String(state.contracts.filter((row) => row.status !== "zakonczony").length), "Portfel bieżący", "yellow")}
      ${metric("Wartość kontraktów", money(contractValue), "Netto", "green")}
      ${metric("Rozliczenia", money(settlements), "Wpisane pozycje", "blue")}
      ${metric("Nieprzypisane FV", String(unassigned.length), money(sum(unassigned, "net_amount_cents")), "red")}
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Stan portfela</h2><p>Najważniejsze kontrakty i stopień zaawansowania robót.</p></div><button class="button button-secondary" type="button" data-view="contracts">Zobacz kontrakty</button></div>
      ${state.contracts.length ? `<div class="table-wrap"><table><thead><tr><th>Kontrakt</th><th>Wartość netto</th><th>Zaawansowanie</th><th>Status</th></tr></thead><tbody>${state.contracts.slice(0, 6).map(contractRow).join("")}</tbody></table></div>` : emptyState("Brak kontraktów. Dodaj pierwszy kontrakt w zakładce „Portfel kontraktów”.")}
    </section>`;
}

function renderContracts() {
  const canAdd = canManageContracts();
  return `
    ${heading("ETW GROUP / KONTRAKTY", "Portfel kontraktów", "Wartość, termin i postęp realizacji kontraktów elektrycznych oraz teletechnicznych.", canAdd ? button("+ Dodaj kontrakt", "contract") : "")}
    <section class="metric-grid">
      ${metric("Wszystkie kontrakty", String(state.contracts.length), "Rejestr bieżący", "yellow")}
      ${metric("Wartość portfela", money(sum(state.contracts, "value_cents")), "Netto", "green")}
      ${metric("W realizacji", String(state.contracts.filter((row) => row.status === "w_realizacji").length), "Aktywne", "blue")}
      ${metric("Wymagają uwagi", String(state.contracts.filter((row) => ["do_decyzji", "ryzyko"].includes(row.status)).length), "Decyzja / ryzyko", "red")}
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Rejestr kontraktów</h2><p>Dane kontraktowe dostępne dla wszystkich uprawnionych użytkowników.</p></div></div>
      ${state.contracts.length ? `<div class="table-wrap"><table><thead><tr><th>Kontrakt</th><th>Branża</th><th>Wartość netto</th><th>Postęp</th><th>Termin</th><th>Status</th></tr></thead><tbody>${state.contracts.map(contractRow).join("")}</tbody></table></div>` : emptyState("Nie ma jeszcze kontraktów.")}
    </section>`;
}

function renderSettlements() {
  const canAdd = canManageContracts();
  return `
    ${heading("ETW GROUP / KONTRAKTY", "Rozliczenia", "Przerób, koszty, płatności i faktury przypisane bezpośrednio do kontraktu.", canAdd ? button("+ Dodaj rozliczenie", "settlement") : "")}
    <section class="metric-grid">
      ${metric("Pozycje", String(state.settlements.length), "Rejestr bieżący", "yellow")}
      ${metric("Wartość rozliczeń", money(sum(state.settlements, "net_amount_cents")), "Netto", "green")}
      ${metric("Do akceptacji", String(state.settlements.filter((row) => row.status === "do_akceptacji").length), "Wymagają decyzji", "red")}
      ${metric("Kontrakty", String(state.contracts.length), "Dostępne do wyboru", "blue")}
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Rejestr rozliczeń</h2><p>Każda pozycja ma przypisany kontrakt i wpływa na jego historię.</p></div></div>
      ${state.settlements.length ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Kontrakt</th><th>Rodzaj</th><th>Opis / nr</th><th>Kwota netto</th><th>Status</th></tr></thead><tbody>${state.settlements.map(settlementRow).join("")}</tbody></table></div>` : emptyState("Brak rozliczeń. Najpierw utwórz kontrakt, a potem dodaj pozycję.")}
    </section>`;
}

function renderInvoices() {
  const canAdd = canManageFinance();
  const unassigned = state.invoices.filter((row) => row.allocation === "unassigned");
  return `
    ${heading("KSeF / REJESTR FAKTUR", "Faktury", "Faktury zakupowe i sprzedażowe. Każdą pozycję można przypisać do kontraktu lub kosztów firmy.", canAdd ? button("+ Dodaj fakturę", "invoice") : "")}
    <section class="metric-grid">
      ${metric("Wszystkie faktury", String(state.invoices.length), "Rejestr bieżący", "yellow")}
      ${metric("Zakupowe", money(sum(state.invoices.filter((row) => row.invoice_type === "purchase"), "net_amount_cents")), "Koszty z FV", "red")}
      ${metric("Sprzedażowe", money(sum(state.invoices.filter((row) => row.invoice_type === "sales"), "net_amount_cents")), "Przychody z FV", "green")}
      ${metric("Do przypisania", money(sum(unassigned, "net_amount_cents")), `${unassigned.length} pozycji`, "yellow")}
    </section>
    <section class="callout"><div class="callout-icon">⇩</div><div><h2>Import KSeF jest przygotowany</h2><p>Struktura bazy i rejestr importów są gotowe. Bezpieczne połączenie KSeF wymaga później osobnej Edge Function po stronie Supabase.</p></div></section>
    <section class="panel">
      <div class="panel-head"><div><h2>Rejestr faktur</h2><p>Dodaj ręcznie fakturę lub przypisz zaimportowaną pozycję do kontraktu.</p></div></div>
      ${state.invoices.length ? `<div class="table-wrap"><table><thead><tr><th>Numer</th><th>Kontrahent</th><th>Data</th><th>Typ</th><th>Przypisanie</th><th>Kwota netto</th><th>Status</th></tr></thead><tbody>${state.invoices.map(invoiceRow).join("")}</tbody></table></div>` : emptyState("Brak faktur w rejestrze.")}
    </section>`;
}

function renderCosts() {
  const canAdd = canManageFinance();
  return `
    ${heading("ETW GROUP / FINANSE", "Koszty firmowe", "Koszty ogólne niezwiązane z konkretnym kontraktem — paliwo, najem, administracja i inne.", canAdd ? button("+ Dodaj koszt", "cost") : "")}
    <section class="metric-grid">
      ${metric("Pozycje", String(state.costs.length), "Rejestr bieżący", "yellow")}
      ${metric("Koszty firmowe", money(sum(state.costs, "net_amount_cents")), "Netto", "red")}
      ${metric("Do płatności", String(state.costs.filter((row) => row.payment_status === "do_platnosci").length), "Bieżące zobowiązania", "blue")}
      ${metric("Opłacone", String(state.costs.filter((row) => row.payment_status === "oplacona").length), "Status płatności", "green")}
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Rejestr kosztów firmowych</h2><p>Pozycje nie są doliczane do budżetu pojedynczego kontraktu.</p></div></div>
      ${state.costs.length ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Kategoria</th><th>Opis</th><th>Dostawca</th><th>Dokument</th><th>Kwota netto</th><th>Status</th></tr></thead><tbody>${state.costs.map(costRow).join("")}</tbody></table></div>` : emptyState("Brak kosztów firmowych.")}
    </section>`;
}

function heading(eyebrow, title, description, actions = "") {
  return `<div class="page-heading"><div class="heading-copy"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</div>`;
}

function button(label, mode) { return `<button class="button button-primary" type="button" data-add="${mode}">${label}</button>`; }
function metric(label, value, tagText, tone) { return `<article class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><span class="tag tag-${tone}">${tagText}</span></article>`; }
function emptyState(text) { return `<div class="empty">${text}</div>`; }

function contractRow(row) {
  return `<tr><td><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.client || "—")}</small></td><td>${escapeHtml(row.trade || "—")}</td><td class="money">${money(row.value_cents)}</td><td class="contract-progress"><strong>${row.baseline_progress}%</strong><div class="progress"><span style="width:${clampProgress(row.baseline_progress)}%"></span></div></td><td>${date(row.due_date)}</td><td>${statusTag(row.status)}</td></tr>`;
}
function settlementRow(row) {
  return `<tr><td>${date(row.settlement_date)}<small>okres: ${date(row.period)}</small></td><td><strong>${escapeHtml(relationName(row.contracts))}</strong></td><td>${escapeHtml(kindLabel(row.kind))}</td><td>${escapeHtml(row.reference_number || row.budget_category || "—")}</td><td class="money">${money(row.net_amount_cents)}</td><td>${statusTag(row.status)}</td></tr>`;
}
function invoiceRow(row) {
  const assignment = row.allocation === "contract" ? relationName(row.contracts) : row.allocation === "company" ? row.company_category : "Nieprzypisana";
  return `<tr><td><strong>${escapeHtml(row.document_number)}</strong><small>${row.source === "ksef" ? "KSeF" : "Ręczna"}</small></td><td>${escapeHtml(row.counterparty)}</td><td>${date(row.issue_date)}</td><td>${row.invoice_type === "sales" ? "Sprzedażowa" : "Zakupowa"}</td><td>${escapeHtml(assignment || "—")}</td><td class="money">${money(row.net_amount_cents)}</td><td>${statusTag(row.payment_status)}</td></tr>`;
}
function costRow(row) {
  return `<tr><td>${date(row.cost_date)}</td><td>${escapeHtml(row.category)}</td><td><strong>${escapeHtml(row.description || "—")}</strong></td><td>${escapeHtml(row.vendor || "—")}</td><td>${escapeHtml(row.document_number || "—")}</td><td class="money">${money(row.net_amount_cents)}</td><td>${statusTag(row.payment_status)}</td></tr>`;
}

function openEntryModal(mode) {
  if ((mode === "contract" || mode === "settlement") && !canManageContracts()) return;
  if ((mode === "invoice" || mode === "cost") && !canManageFinance()) return;
  state.modalMode = mode;
  formError.hidden = true;
  const definitions = formDefinition(mode);
  modalEyebrow.textContent = definitions.eyebrow;
  modalTitle.textContent = definitions.title;
  modalFields.innerHTML = definitions.fields;
  modal.showModal();
}

function formDefinition(mode) {
  const options = (items, selected = "") => items.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const contracts = state.contracts.map((row) => [row.id, row.name]);
  const contractSelect = contracts.length ? options([["", "Wybierz kontrakt"], ...contracts]) : `<option value="">Najpierw dodaj kontrakt</option>`;
  const today = new Date().toISOString().slice(0, 10);
  const firstDay = `${today.slice(0, 7)}-01`;
  const field = (label, control, className = "") => `<label class="${className}">${label}${control}</label>`;
  const input = (name, type, extra = "") => `<input name="${name}" type="${type}" ${extra} />`;
  const select = (name, values, extra = "") => `<select name="${name}" ${extra}>${values}</select>`;
  const moneyInput = (name = "net_amount") => input(name, "number", "min=\"0\" step=\"0.01\" required");
  const statusOptions = options([["nowa", "Nowa"], ["do_platnosci", "Do płatności"], ["oplacona", "Opłacona"], ["zaksiegowana", "Zaksięgowana"]], "do_platnosci");

  if (mode === "contract") return {
    eyebrow: "NOWY KONTRAKT", title: "Dodaj kontrakt", fields: [
      field("Nazwa kontraktu", input("name", "text", "required"), "full"),
      field("Klient", input("client", "text", "required")),
      field("Branża", select("trade", options([["elektryczna", "Elektryczna"], ["teletechniczna", "Teletechniczna"], ["mieszana", "Mieszana"]]))),
      field("Wartość netto (zł)", moneyInput("value")),
      field("Budżet kosztów netto (zł)", moneyInput("budget")),
      field("Zaawansowanie bazowe (%)", input("baseline_progress", "number", "min=\"0\" max=\"100\" value=\"0\" required")),
      field("Termin umowny", input("due_date", "date")),
      field("Status", select("status", options([["w_realizacji", "W realizacji"], ["do_decyzji", "Do decyzji"], ["ryzyko", "Ryzyko"], ["zakonczony", "Zakończony"]]))),
    ].join("")
  };
  if (mode === "settlement") return {
    eyebrow: "ROZLICZENIE KONTRAKTU", title: "Dodaj rozliczenie", fields: [
      field("Kontrakt", select("contract_id", contractSelect, "required"), "full"),
      field("Okres", input("period", "date", `value=\"${firstDay}\" required`)),
      field("Data rozliczenia", input("settlement_date", "date", `value=\"${today}\" required`)),
      field("Rodzaj", select("kind", options([["przerob", "Przerób"], ["faktura", "Faktura"], ["koszt", "Koszt"], ["platnosc", "Płatność"], ["zaliczka", "Zaliczka"], ["korekta", "Korekta"]]))),
      field("Kwota netto (zł)", moneyInput()),
      field("VAT (%)", input("vat_rate", "number", "min=\"0\" max=\"100\" step=\"0.01\" value=\"23\" required")),
      field("Numer / opis", input("reference_number", "text")),
      field("Kategoria budżetowa", input("budget_category", "text", "value=\"pozostałe\"")),
      field("Status", select("status", options([["robocze", "Robocze"], ["do_akceptacji", "Do akceptacji"], ["zafakturowane", "Zafakturowane"], ["oplacone", "Opłacone"]]))),
    ].join("")
  };
  if (mode === "invoice") return {
    eyebrow: "REJESTR FAKTUR", title: "Dodaj fakturę", fields: [
      field("Typ faktury", select("invoice_type", options([["purchase", "Zakupowa"], ["sales", "Sprzedażowa"]]))),
      field("Źródło", select("source", options([["manual", "Ręczna"], ["ksef", "KSeF"]]))),
      field("Numer dokumentu", input("document_number", "text", "required")),
      field("Kontrahent", input("counterparty", "text", "required")),
      field("Data wystawienia", input("issue_date", "date", `value=\"${today}\" required`)),
      field("Termin płatności", input("due_date", "date")),
      field("Kwota netto (zł)", moneyInput()),
      field("VAT (%)", input("vat_rate", "number", "min=\"0\" max=\"100\" step=\"0.01\" value=\"23\" required")),
      field("Przypisanie", select("allocation", options([["unassigned", "Do przypisania"], ["contract", "Kontrakt"], ["company", "Koszt firmowy"]]))),
      field("Kontrakt (gdy przypisanie: kontrakt)", select("contract_id", contractSelect)),
      field("Kategoria firmowa (gdy koszt firmowy)", input("company_category", "text")),
      field("Status płatności", select("payment_status", statusOptions)),
    ].join("")
  };
  return {
    eyebrow: "KOSZTY FIRMOWE", title: "Dodaj koszt firmowy", fields: [
      field("Data kosztu", input("cost_date", "date", `value=\"${today}\" required`)),
      field("Kategoria", select("category", options([["paliwo", "Paliwo"], ["najem", "Najem lokalu"], ["narzedzia", "Narzędzia"], ["administracja", "Administracja"], ["inne", "Inne"]]))),
      field("Opis", `<textarea name="description" placeholder="Np. najem biura — wrzesień"></textarea>`, "full"),
      field("Dostawca", input("vendor", "text")),
      field("Numer dokumentu", input("document_number", "text")),
      field("Kwota netto (zł)", moneyInput()),
      field("VAT (%)", input("vat_rate", "number", "min=\"0\" max=\"100\" step=\"0.01\" value=\"23\" required")),
      field("Status płatności", select("payment_status", statusOptions)),
    ].join("")
  };
}

entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const supabase = state.supabase;
  const form = new FormData(entryForm);
  const mode = state.modalMode;
  const submit = entryForm.querySelector("button[type=submit]");
  formError.hidden = true;

  try {
    submit.disabled = true;
    submit.textContent = "Zapisywanie…";
    const { table, payload } = formPayload(mode, form);
    const { error } = await supabase.from(table).insert(payload);
    if (error) throw error;
    modal.close();
    await loadView(supabase);
  } catch (error) {
    formError.textContent = error.message || "Nie udało się zapisać pozycji.";
    formError.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = "Zapisz";
  }
});

document.querySelector("#modal-close").addEventListener("click", () => modal.close());
document.querySelector("#modal-cancel").addEventListener("click", () => modal.close());

function formPayload(mode, form) {
  const value = (key) => String(form.get(key) || "").trim();
  const number = (key) => toCents(value(key));
  const vat = () => Number(value("vat_rate") || 0);
  if (mode === "contract") return { table: "contracts", payload: { name: value("name"), client: value("client"), trade: value("trade"), value_cents: number("value"), budget_cents: number("budget"), baseline_progress: Number(value("baseline_progress")), due_date: value("due_date") || null, status: value("status"), created_by: state.user.id } };
  if (mode === "settlement") return { table: "settlements", payload: { contract_id: value("contract_id"), period: value("period"), settlement_date: value("settlement_date"), kind: value("kind"), net_amount_cents: number("net_amount"), vat_rate: vat(), reference_number: value("reference_number"), budget_category: value("budget_category") || "pozostale", status: value("status"), created_by: state.user.id } };
  if (mode === "invoice") {
    const allocation = value("allocation");
    const contractId = value("contract_id");
    const category = value("company_category");
    if (allocation === "contract" && !contractId) throw new Error("Wybierz kontrakt dla tego przypisania.");
    if (allocation === "company" && !category) throw new Error("Podaj kategorię kosztu firmowego.");
    return { table: "invoices", payload: { invoice_type: value("invoice_type"), source: value("source"), document_number: value("document_number"), counterparty: value("counterparty"), issue_date: value("issue_date"), due_date: value("due_date") || null, net_amount_cents: number("net_amount"), vat_rate: vat(), allocation, contract_id: allocation === "contract" ? contractId : null, company_category: allocation === "company" ? category : null, payment_status: value("payment_status"), created_by: state.user.id } };
  }
  return { table: "company_costs", payload: { cost_date: value("cost_date"), category: value("category"), description: value("description"), vendor: value("vendor"), document_number: value("document_number"), net_amount_cents: number("net_amount"), vat_rate: vat(), payment_status: value("payment_status"), created_by: state.user.id } };
}

function canManageContracts() { return ["owner", "manager"].includes(state.profile?.role); }
function canManageFinance() { return ["owner", "accountant"].includes(state.profile?.role); }
function normalizeSupabaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.hostname === "supabase.com" || url.pathname.startsWith("/dashboard")) return "";
    return url.origin;
  } catch {
    return "";
  }
}
function sum(rows, field) { return rows.reduce((total, row) => total + Number(row[field] || 0), 0); }
function money(cents) { return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(cents || 0) / 100); }
function date(value) { return value ? new Intl.DateTimeFormat("pl-PL").format(new Date(`${value}T12:00:00`)) : "—"; }
function toCents(value) { const amount = Number(String(value).replace(",", ".")); if (!Number.isFinite(amount) || amount < 0) throw new Error("Podaj prawidłową kwotę dodatnią lub zero."); return Math.round(amount * 100); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", "\"": "&quot;" })[char]); }
function relationName(relation) { return Array.isArray(relation) ? relation[0]?.name || "—" : relation?.name || "—"; }
function clampProgress(value) { return Math.max(0, Math.min(100, Number(value || 0))); }
function kindLabel(kind) { return ({ przerob: "Przerób", faktura: "Faktura", koszt: "Koszt", platnosc: "Płatność", zaliczka: "Zaliczka", korekta: "Korekta" })[kind] || kind || "—"; }
function roleLabel(role) { return ({ owner: "Właściciel", manager: "Kierownik", accountant: "Księgowość", viewer: "Podgląd" })[role] || "Podgląd"; }
function statusTag(status) { const names = { w_realizacji: "W realizacji", do_decyzji: "Do decyzji", ryzyko: "Ryzyko", zakonczony: "Zakończony", robocze: "Robocze", do_akceptacji: "Do akceptacji", zafakturowane: "Zafakturowane", oplacone: "Opłacone", nowa: "Nowa", do_platnosci: "Do płatności", zaksiegowana: "Zaksięgowana" }; const tone = ["ryzyko", "do_decyzji", "do_akceptacji"].includes(status) ? "red" : ["w_realizacji", "oplacone", "zaksiegowana", "zakonczony"].includes(status) ? "green" : "blue"; return `<span class="tag tag-${tone}">${names[status] || escapeHtml(status)}</span>`; }
