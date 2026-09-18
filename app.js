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
  alerts: { label: "Alerty i terminy", icon: "!" },
  reports: { label: "Raporty", icon: "▥" },
  users: { label: "Zespół i uprawnienia", icon: "◉" },
  contractDetail: { label: "Karta kontraktu", icon: "▦" },
};

const state = {
  activeView: "dashboard",
  user: null,
  profile: null,
  contracts: [],
  settlements: [],
  invoices: [],
  costs: [],
  changes: [],
  documents: [],
  schedule: [],
  alerts: [],
  importRuns: [],
  invoiceMonth: "",
  costMonth: "",
  history: [],
  users: [],
  contractDetail: null,
  modalMode: null,
  modalRecord: null,
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
    <section class="auth-screen" style="position:fixed;inset:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr);place-content:stretch;width:100vw;height:100vh;height:100dvh;min-height:0;margin:0;padding:0;overflow:hidden">
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
          <img class="sidebar-etw-logo" src="https://etwgroup.pl/wp-content/uploads/2024/10/ETW-logo.png" alt="ETW Group" width="142" height="85" />
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
        <p class="nav-label">ANALIZY</p>
        <nav class="nav" aria-label="Raporty">
          ${navButton("alerts")}
          ${navButton("reports")}
        </nav>
        ${isOwner() ? `<p class="nav-label">ADMINISTRACJA</p><nav class="nav" aria-label="Administracja">${navButton("users")}</nav>` : ""}
        <div class="sidebar-footer">
          <p class="connection-status"><i></i>Bezpieczne połączenie</p>
          <button class="sidebar-account" id="logout-button" type="button" title="Wyloguj się">
            <span class="account-avatar">${escapeHtml(userInitials())}</span>
            <span class="account-details"><strong>${escapeHtml(userDisplayName())}</strong><small>${escapeHtml(roleLabel(state.profile.role))}</small></span>
            <span class="account-logout" aria-hidden="true">↪</span>
          </button>
        </div>
      </aside>
      <section class="workspace">
        <header class="topbar">
          <div class="breadcrumb">ETW Group <span>/</span> <strong id="breadcrumb-view">Przegląd</strong></div>
          <div class="topbar-actions">
            <span class="status"><i class="status-dot"></i>Baza aktywna</span>
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
      const contract = event.target.closest("[data-contract-id]");
      if (contract) {
        state.contractDetail = { id: contract.dataset.contractId };
        state.activeView = "contractDetail";
        renderShell(state.supabase);
        await loadView(state.supabase);
        return;
      }
      const action = event.target.closest("[data-action]");
      if (action) await handleAction(action);
      if (event.target.closest("#logout-button")) await state.supabase.auth.signOut();
    });
    app.addEventListener("change", async (event) => {
      const picker = event.target.closest("[data-month-picker]");
      if (!picker?.value) return;
      const stateKey = picker.dataset.monthPicker === "invoice" ? "invoiceMonth" : "costMonth";
      state[stateKey] = picker.value;
      await loadView(state.supabase);
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
      state.contracts = await selectRows(supabase, "contracts", "id, name, client, trade, contract_number, description, value_cents, budget_cents, baseline_progress, due_date, status", "created_at", false);
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
    if (state.activeView === "alerts") {
      await loadAlertData(supabase);
      page.innerHTML = renderAlerts();
    }
    if (state.activeView === "contractDetail") {
      await loadContractDetailData(supabase);
      page.innerHTML = renderContractDetail();
    }
    if (state.activeView === "reports") {
      await loadDashboardData(supabase);
      page.innerHTML = renderReports();
    }
    if (state.activeView === "users") {
      if (!isOwner()) throw new Error("Brak uprawnień do zarządzania zespołem.");
      state.users = await selectRows(supabase, "profiles", "id, email, full_name, role, active, created_at", "created_at", false);
      page.innerHTML = renderUsers();
    }
  } catch (error) {
    page.innerHTML = `<section class="panel"><div class="empty">Nie udało się pobrać danych: ${escapeHtml(error.message || "nieznany błąd")}</div></section>`;
  }
}

async function loadDashboardData(supabase) {
  const [contracts, settlements, invoices, costs] = await Promise.all([
    selectRows(supabase, "contracts", "id, name, client, trade, contract_number, value_cents, budget_cents, baseline_progress, due_date, status", "created_at", false),
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
    selectRows(supabase, "contracts", "id, name, retention_percent", "name", true),
    selectRows(supabase, "settlements", "id, contract_id, period, settlement_date, kind, net_amount_cents, vat_rate, reference_number, budget_category, status, contracts(name)", "settlement_date", false),
  ]);
  state.contracts = contracts;
  state.settlements = settlements;
}

async function loadInvoiceData(supabase) {
  const [contracts, invoices, importRuns] = await Promise.all([
    selectRows(supabase, "contracts", "id, name", "name", true),
    selectRows(supabase, "invoices", "id, invoice_type, source, document_number, ksef_number, counterparty, issue_date, due_date, net_amount_cents, vat_rate, allocation, contract_id, company_category, payment_status, contracts(name)", "issue_date", false),
    canManageFinance() ? selectRows(supabase, "invoice_import_runs", "id, status, environment, imported_count, skipped_count, error_message, created_at, finished_at", "created_at", false) : Promise.resolve([]),
  ]);
  state.contracts = contracts;
  state.invoices = invoices;
  state.importRuns = importRuns;
}

async function loadContractDetailData(supabase) {
  const contractId = state.contractDetail?.id;
  if (!contractId) throw new Error("Nie wybrano kontraktu.");
  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id, name, client, trade, contract_number, description, value_cents, budget_cents, baseline_progress, due_date, status, manager_id, retention_percent")
    .eq("id", contractId)
    .single();
  if (contractError) throw contractError;
  const [settlements, invoices, changes, documents, schedule, history] = await Promise.all([
    selectRowsBy(supabase, "settlements", "id, contract_id, period, settlement_date, kind, net_amount_cents, vat_rate, reference_number, budget_category, status, approved_at", "contract_id", contractId, "settlement_date", false),
    selectRowsBy(supabase, "invoices", "id, invoice_type, source, document_number, counterparty, issue_date, due_date, net_amount_cents, vat_rate, allocation, contract_id, company_category, payment_status", "contract_id", contractId, "issue_date", false),
    selectRowsBy(supabase, "contract_changes", "id, kind, title, description, net_amount_cents, status, due_date, decided_at", "contract_id", contractId, "created_at", false),
    selectRowsBy(supabase, "contract_documents", "id, file_name, storage_path, mime_type, size_bytes, created_at", "contract_id", contractId, "created_at", false),
    selectRowsBy(supabase, "contract_schedule_items", "id, contract_id, title, start_date, end_date, responsible, progress, status, notes, depends_on_id, is_milestone", "contract_id", contractId, "start_date", true),
    loadContractHistory(supabase, contractId),
  ]);
  state.contractDetail = contract;
  state.settlements = settlements;
  state.invoices = invoices;
  state.changes = changes;
  state.documents = documents;
  state.schedule = schedule;
  state.history = history;
}

async function loadAlertData(supabase) {
  const [contracts, settlements, invoices, schedule, changes] = await Promise.all([
    selectRows(supabase, "contracts", "id, name, client, value_cents, budget_cents, due_date, status", "due_date", true),
    selectRows(supabase, "settlements", "id, contract_id, kind, net_amount_cents, status", "settlement_date", false),
    selectRows(supabase, "invoices", "id, contract_id, invoice_type, document_number, counterparty, net_amount_cents, allocation, due_date, payment_status", "due_date", true),
    selectRows(supabase, "contract_schedule_items", "id, contract_id, title, end_date, progress, status", "end_date", true),
    selectRows(supabase, "contract_changes", "id, contract_id, kind, title, due_date, status", "due_date", true),
  ]);
  state.contracts = contracts;
  state.settlements = settlements;
  state.invoices = invoices;
  state.schedule = schedule;
  state.changes = changes;
  state.alerts = collectAlerts({ contracts, settlements, invoices, schedule, changes });
}

async function selectRows(supabase, table, columns, orderColumn, ascending) {
  const { data, error } = await supabase.from(table).select(columns).order(orderColumn, { ascending });
  if (error) throw error;
  return data || [];
}

async function selectRowsBy(supabase, table, columns, filterColumn, filterValue, orderColumn, ascending) {
  const { data, error } = await supabase.from(table).select(columns).eq(filterColumn, filterValue).order(orderColumn, { ascending });
  if (error) throw error;
  return data || [];
}

async function loadContractHistory(supabase, contractId) {
  if (!isOwner()) return [];
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, created_at")
    .eq("entity", "contracts")
    .eq("entity_id", contractId)
    .order("created_at", { ascending: false })
    .limit(12);
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
      ${state.contracts.length ? `<div class="table-wrap"><table><thead><tr><th>Kontrakt</th><th>Branża</th><th>Wartość netto</th><th>Zaawansowanie</th><th>Termin</th><th>Status</th></tr></thead><tbody>${state.contracts.slice(0, 6).map(contractRow).join("")}</tbody></table></div>` : emptyState("Brak kontraktów. Dodaj pierwszy kontrakt w zakładce „Portfel kontraktów”.")}
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
      ${state.contracts.length ? `<div class="table-wrap"><table><thead><tr><th>Kontrakt</th><th>Branża</th><th>Wartość netto</th><th>Postęp</th><th>Termin</th><th>Status</th><th></th></tr></thead><tbody>${state.contracts.map(contractListRow).join("")}</tbody></table></div>` : emptyState("Nie ma jeszcze kontraktów.")}
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
  const monthlyInvoices = groupRowsByMonth(state.invoices, "issue_date");
  const activeMonth = selectedMonthKey("invoiceMonth", monthlyInvoices);
  const visibleInvoices = activeMonth ? state.invoices.filter((row) => monthKey(row.issue_date) === activeMonth) : [];
  const unassigned = visibleInvoices.filter((row) => row.allocation === "unassigned");
  const recentRuns = state.importRuns.slice(0, 5);
  return `
    ${heading("KSeF / REJESTR FAKTUR", "Faktury", "Faktury zakupowe i sprzedażowe. Każdą pozycję można przypisać do kontraktu lub kosztów firmy.", canAdd ? button("+ Dodaj fakturę", "invoice") : "")}
    ${monthNavigator("invoice", activeMonth, monthlyInvoices, "faktur")}
    <section class="metric-grid">
      ${metric("Faktury", String(visibleInvoices.length), activeMonth ? monthLabel(activeMonth) : "Brak danych", "yellow")}
      ${metric("Zakupowe", money(sum(visibleInvoices.filter((row) => row.invoice_type === "purchase"), "net_amount_cents")), "Koszty z FV", "red")}
      ${metric("Sprzedażowe", money(sum(visibleInvoices.filter((row) => row.invoice_type === "sales"), "net_amount_cents")), "Przychody z FV", "green")}
      ${metric("Do przypisania", money(sum(unassigned, "net_amount_cents")), `${unassigned.length} pozycji`, "yellow")}
    </section>
    <section class="callout"><div class="callout-icon">⇩</div><div><h2>Import KSeF</h2><p>Import jest uruchamiany wyłącznie po stronie Supabase. Najpierw sprawdź konfigurację w środowisku testowym, a produkcję uruchamiaj po podłączeniu firmowego tokenu lub certyfikatu.</p></div>${canAdd ? `<div class="callout-actions"><button class="button button-secondary" type="button" data-action="import-ksef-test">Test KSeF</button><button class="button button-primary" type="button" data-action="import-ksef-production">Import produkcyjny</button></div>` : ""}</section>
    ${canAdd ? `<section class="panel import-runs"><div class="panel-head"><div><h2>Ostatnie importy KSeF</h2><p>Historia bezpiecznych zleceń importu; dane dostępowe nie są widoczne w aplikacji.</p></div></div>${recentRuns.length ? `<div class="table-wrap"><table><thead><tr><th>Uruchomiono</th><th>Środowisko</th><th>Status</th><th>Pobrano</th><th>Pomijane</th><th>Informacja</th></tr></thead><tbody>${recentRuns.map(importRunRow).join("")}</tbody></table></div>` : emptyState("Nie uruchomiono jeszcze importu KSeF.")}</section>` : ""}
    <section class="panel">
      <div class="panel-head"><div><h2>Rejestr faktur — ${escapeHtml(activeMonth ? monthLabel(activeMonth) : "brak miesiąca")}</h2><p>Dodaj ręcznie fakturę lub przypisz zaimportowaną pozycję do kontraktu.</p></div></div>
      ${visibleInvoices.length ? `<div class="table-wrap"><table><thead><tr><th>Numer</th><th>Kontrahent</th><th>Data</th><th>Typ</th><th>Przypisanie</th><th>Kwota netto</th><th>Status</th><th></th></tr></thead><tbody>${visibleInvoices.map(invoiceRow).join("")}</tbody></table></div>` : emptyState("Brak faktur w wybranym miesiącu.")}
    </section>`;
}

function renderCosts() {
  const canAdd = canManageFinance();
  const categories = ["paliwo", "narzedzia", "ubior_bhp", "najem_lokali", "pozostale"];
  const monthlyCosts = groupRowsByMonth(state.costs, "cost_date");
  const activeMonth = selectedMonthKey("costMonth", monthlyCosts);
  const visibleCosts = activeMonth ? state.costs.filter((row) => monthKey(row.cost_date) === activeMonth) : [];
  return `
    ${heading("ETW GROUP / FINANSE", "Koszty firmowe", "Koszty ogólne niezwiązane z konkretnym kontraktem, podzielone na pięć kategorii firmowych.", canAdd ? button("+ Dodaj koszt", "cost") : "")}
    ${monthNavigator("cost", activeMonth, monthlyCosts, "kosztów")}
    <section class="metric-grid">
      ${metric("Pozycje", String(visibleCosts.length), activeMonth ? monthLabel(activeMonth) : "Brak danych", "yellow")}
      ${metric("Koszty firmowe", money(sum(visibleCosts, "net_amount_cents")), "Netto", "red")}
      ${metric("Do płatności", String(visibleCosts.filter((row) => row.payment_status === "do_platnosci").length), "Bieżące zobowiązania", "blue")}
      ${metric("Opłacone", String(visibleCosts.filter((row) => row.payment_status === "oplacona").length), "Status płatności", "green")}
    </section>
    <section class="cost-breakdown" aria-label="Podział kosztów firmowych">${categories.map((category) => costCategoryCard(category, visibleCosts)).join("")}</section>
    <section class="panel">
      <div class="panel-head"><div><h2>Rejestr kosztów — ${escapeHtml(activeMonth ? monthLabel(activeMonth) : "brak miesiąca")}</h2><p>Pozycje nie są doliczane do budżetu pojedynczego kontraktu.</p></div></div>
      ${visibleCosts.length ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Kategoria</th><th>Opis</th><th>Dostawca</th><th>Dokument</th><th>Kwota netto</th><th>Status</th><th></th></tr></thead><tbody>${visibleCosts.map(costRow).join("")}</tbody></table></div>` : emptyState("Brak kosztów w wybranym miesiącu.")}
    </section>`;
}

function renderAlerts() {
  const critical = state.alerts.filter((row) => row.severity === "critical");
  const warnings = state.alerts.filter((row) => row.severity === "warning");
  const info = state.alerts.filter((row) => row.severity === "info");
  return `
    ${heading("ETW GROUP / KONTROLA", "Alerty i terminy", "Automatyczna kontrola budżetów, harmonogramów, płatności i faktur wymagających przypisania.")}
    <section class="metric-grid">
      ${metric("Krytyczne", String(critical.length), "Wymagają reakcji", "red")}
      ${metric("Ostrzeżenia", String(warnings.length), "Termin / budżet", "yellow")}
      ${metric("Informacyjne", String(info.length), "Do weryfikacji", "blue")}
      ${metric("Wszystkie alerty", String(state.alerts.length), "Bieżący stan", state.alerts.length ? "yellow" : "green")}
    </section>
    <section class="panel alerts-panel"><div class="panel-head"><div><h2>Centrum kontroli</h2><p>Alerty są liczone z danych zapisanych w PrądPlan i nie zastępują decyzji kierownika kontraktu.</p></div></div>${state.alerts.length ? `<div class="alert-list">${state.alerts.map(alertRow).join("")}</div>` : `<div class="empty">Brak aktywnych alertów. Wszystkie terminy, budżety i przypisania wyglądają prawidłowo.</div>`}</section>`;
}

function renderContractDetail() {
  const contract = state.contractDetail;
  const settlementRevenue = sum(state.settlements.filter((row) => ["przerob", "faktura"].includes(row.kind)), "net_amount_cents");
  const invoiceRevenue = sum(state.invoices.filter((row) => row.invoice_type === "sales"), "net_amount_cents");
  const settlementCosts = sum(state.settlements.filter((row) => row.kind === "koszt"), "net_amount_cents");
  const invoiceCosts = sum(state.invoices.filter((row) => row.invoice_type === "purchase"), "net_amount_cents");
  const revenue = settlementRevenue + invoiceRevenue;
  const actualCosts = settlementCosts + invoiceCosts;
  const approvedChanges = sum(state.changes.filter((row) => row.status === "zaakceptowane"), "net_amount_cents");
  const forecastValue = Number(contract.value_cents) + approvedChanges;
  const forecastMargin = forecastValue - Math.max(actualCosts, 0);
  const remainingToInvoice = forecastValue - invoiceRevenue;
  const retentionPercent = Number(contract.retention_percent || 0);
  const retentionCollected = sum(state.invoices.filter((row) => row.invoice_type === "sales").map((row) => ({ amount: retentionAmount(row.net_amount_cents, retentionPercent) })), "amount");
  const scheduleDone = state.schedule.filter((row) => row.status === "zakonczony").length;
  const scheduleDelayed = state.schedule.filter((row) => row.status === "opozniony").length;
  const editable = canManageContracts();
  return `
    <div class="page-heading"><div class="heading-copy"><p class="eyebrow">KARTA KONTRAKTU / ${escapeHtml(contract.trade || "KONTRAKT")}</p><h1>${escapeHtml(contract.name)}</h1><p>${escapeHtml(contract.client || "Brak klienta")}${contract.contract_number ? ` · ${escapeHtml(contract.contract_number)}` : ""}</p></div><div class="page-actions"><button class="button button-secondary" type="button" data-view="contracts">← Portfel</button>${editable ? `<button class="button button-secondary" type="button" data-action="edit-contract">Edytuj</button><button class="button button-secondary button-danger" type="button" data-action="delete-contract">Usuń</button>${button("+ Zadanie", "schedule")} ${button("+ Rozliczenie", "settlement")} ${button("+ Zmiana", "change")} ${button("+ Dokument", "document")}` : ""}</div></div>
    <section class="metric-grid">
      ${metric("Wartość kontraktu", money(forecastValue), approvedChanges ? `Zmiany: ${money(approvedChanges)}` : "Wartość umowna netto", "yellow")}
      ${metric("Wpisane koszty", money(actualCosts), `${Math.round((actualCosts / Math.max(Number(contract.budget_cents), 1)) * 100)}% budżetu`, actualCosts > Number(contract.budget_cents) ? "red" : "blue")}
      ${metric("Przychody / przerób", money(revenue), "Pozycje w rejestrze", "green")}
      ${metric("Marża prognozowana", money(forecastMargin), forecastMargin < 0 ? "Wymaga decyzji" : "Po kosztach wpisanych", forecastMargin < 0 ? "red" : "green")}
      ${metric("Pozostało do zafakturowania", money(remainingToInvoice), remainingToInvoice < 0 ? "Przekroczono wartość" : "Wg faktur sprzedażowych", remainingToInvoice < 0 ? "red" : "yellow")}
      ${metric("Kaucja pobrana", money(retentionCollected), retentionPercent ? `${percentLabel(retentionPercent)} z faktur sprzedażowych` : "Kaucja nieustawiona", retentionPercent ? "blue" : "yellow")}
    </section>
    <section class="contract-summary panel"><div><p class="eyebrow">STATUS REALIZACJI</p><h2>${statusTag(contract.status)}</h2><p>${escapeHtml(contract.description || "Brak dodatkowego opisu kontraktu.")}</p></div><div class="contract-progress"><strong>${contract.baseline_progress}%</strong><div class="progress"><span style="width:${clampProgress(contract.baseline_progress)}%"></span></div><small>Termin umowny: ${date(contract.due_date)}</small></div></section>
    ${isOwner() ? `<section class="panel contract-history"><div class="panel-head"><div><h2>Historia kontraktu</h2><p>Audyt zmian metadanych kontraktu — dostępny wyłącznie dla właściciela.</p></div></div>${state.history.length ? `<div class="history-list">${state.history.map(historyRow).join("")}</div>` : emptyState("Brak zarejestrowanych zmian kontraktu.")}</section>` : ""}
    <section class="panel schedule-panel"><div class="panel-head"><div><h2>Harmonogram kontraktu</h2><p>${state.schedule.length ? `${scheduleDone} z ${state.schedule.length} zadań zakończonych${scheduleDelayed ? ` · ${scheduleDelayed} opóźnionych` : ""}` : "Zadania, terminy i odpowiedzialność za realizację."}</p></div>${editable ? button("+ Dodaj zadanie", "schedule") : ""}</div>${state.schedule.length ? `<div class="table-wrap"><table><thead><tr><th>Zadanie</th><th>Termin</th><th>Odpowiedzialny</th><th>Postęp</th><th>Status</th><th></th></tr></thead><tbody>${state.schedule.map(scheduleRow).join("")}</tbody></table></div>${renderGantt(state.schedule)}` : emptyState("Brak zadań w harmonogramie. Dodaj pierwszy etap realizacji.")}</section>
    <section class="detail-grid">
      <section class="panel"><div class="panel-head"><div><h2>Rozliczenia</h2><p>Pozycje przypisane do tego kontraktu.</p></div></div>${state.settlements.length ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Rodzaj</th><th>Opis</th><th>Netto</th><th>Status</th><th></th></tr></thead><tbody>${state.settlements.map(detailSettlementRow).join("")}</tbody></table></div>` : emptyState("Brak rozliczeń.")}</section>
      <section class="panel"><div class="panel-head"><div><h2>Faktury kontraktu</h2><p>Zakupowe oraz sprzedażowe przypisane do tego kontraktu. Kaucja: ${percentLabel(retentionPercent)}.</p></div>${canManageFinance() ? button("+ Faktura", "invoice") : ""}</div>${state.invoices.length ? `<div class="table-wrap"><table><thead><tr><th>Numer</th><th>Kontrahent</th><th>Typ</th><th>Netto</th><th>Kaucja</th><th>Status</th><th></th></tr></thead><tbody>${state.invoices.map(detailInvoiceRow).join("")}</tbody></table></div>` : emptyState("Brak przypisanych faktur.")}</section>
    </section>
    <section class="detail-grid">
      <section class="panel"><div class="panel-head"><div><h2>Zmiany, roszczenia i ryzyka</h2><p>Rejestr decyzji wpływających na kontrakt.</p></div>${editable ? button("+ Dodaj pozycję", "change") : ""}</div>${state.changes.length ? `<div class="table-wrap"><table><thead><tr><th>Rodzaj</th><th>Pozycja</th><th>Wpływ netto</th><th>Termin</th><th>Status</th><th></th></tr></thead><tbody>${state.changes.map(changeRow).join("")}</tbody></table></div>` : emptyState("Brak zmian i roszczeń.")}</section>
      <section class="panel"><div class="panel-head"><div><h2>Dokumenty kontraktu</h2><p>Umowy, protokoły, kosztorysy oraz ustalenia.</p></div>${editable ? button("+ Dodaj dokument", "document") : ""}</div>${state.documents.length ? `<div class="document-list">${state.documents.map(documentRow).join("")}</div>` : emptyState("Brak dokumentów.")}</section>
    </section>`;
}

function renderReports() {
  const contractValue = sum(state.contracts, "value_cents");
  const purchaseInvoices = sum(state.invoices.filter((row) => row.invoice_type === "purchase"), "net_amount_cents");
  const salesInvoices = sum(state.invoices.filter((row) => row.invoice_type === "sales"), "net_amount_cents");
  const operatingCosts = sum(state.costs, "net_amount_cents");
  const forecast = contractValue - purchaseInvoices - operatingCosts;
  return `
    ${heading("ETW GROUP / ANALIZY", "Raport finansowy", "Zestawienie portfela, faktur i kosztów firmy do bieżącej kontroli marży.", `<button class="button button-secondary" type="button" data-action="print-report">Drukuj / PDF</button><button class="button button-primary" type="button" data-action="export-report">Excel (CSV)</button>`)}
    <section class="metric-grid">
      ${metric("Portfel kontraktów", money(contractValue), `${state.contracts.length} kontraktów`, "yellow")}
      ${metric("Faktury sprzedażowe", money(salesInvoices), "Przychody z FV", "green")}
      ${metric("Faktury zakupowe", money(purchaseInvoices), "Koszty kontraktowe", "red")}
      ${metric("Prognoza po kosztach", money(forecast), "Portfel − koszty", forecast < 0 ? "red" : "green")}
    </section>
    <section class="panel report-table"><div class="panel-head"><div><h2>Rentowność kontraktów</h2><p>Kwoty netto; raport uwzględnia pozycje zarejestrowane w PrądPlan.</p></div></div><div class="table-wrap"><table><thead><tr><th>Kontrakt</th><th>Wartość</th><th>Budżet</th><th>Postęp</th><th>Status</th></tr></thead><tbody>${state.contracts.map(reportContractRow).join("")}</tbody></table></div></section>`;
}

function renderUsers() {
  return `
    ${heading("ETW GROUP / ADMINISTRACJA", "Zespół i uprawnienia", "Twórz konta firmowe, aktywuj użytkowników i przypisuj role w PrądPlan.", button("+ Utwórz konto", "invite"))}
    <section class="metric-grid">
      ${metric("Wszystkie konta", String(state.users.length), "Zarejestrowani użytkownicy", "yellow")}
      ${metric("Aktywne", String(state.users.filter((row) => row.active).length), "Mają dostęp", "green")}
      ${metric("Oczekujące", String(state.users.filter((row) => !row.active).length), "Wymagają aktywacji", "red")}
      ${metric("Kierownicy / księgowość", String(state.users.filter((row) => ["manager", "accountant"].includes(row.role)).length), "Role operacyjne", "blue")}
    </section>
    <section class="panel"><div class="panel-head"><div><h2>Konta użytkowników</h2><p>Właściciel zarządza rolami i aktywnością kont.</p></div></div><div class="table-wrap"><table><thead><tr><th>Użytkownik</th><th>Rola</th><th>Dostęp</th><th>Utworzono</th><th></th></tr></thead><tbody>${state.users.map(userRow).join("")}</tbody></table></div></section>`;
}

function heading(eyebrow, title, description, actions = "") {
  return `<div class="page-heading"><div class="heading-copy"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</div>`;
}

function button(label, mode) { return `<button class="button button-primary" type="button" data-add="${mode}">${label}</button>`; }
function metric(label, value, tagText, tone) { return `<article class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><span class="tag tag-${tone}">${tagText}</span></article>`; }
function emptyState(text) { return `<div class="empty">${text}</div>`; }
function costCategoryCard(category, rows) {
  const matching = rows.filter((row) => normalizeCostCategory(row.category) === category);
  return `<article class="cost-category-card"><p>${escapeHtml(costCategoryLabel(category))}</p><strong>${money(sum(matching, "net_amount_cents"))}</strong><small>${matching.length} ${matching.length === 1 ? "pozycja" : "pozycje"}</small></article>`;
}
function monthNavigator(kind, activeMonth, _groups, noun) {
  const selected = activeMonth || currentMonthKey();
  const hasNewerMonth = selected < currentMonthKey();
  return `<section class="month-navigator" aria-label="Nawigacja miesięczna ${escapeHtml(noun)}"><button class="month-button" type="button" data-action="${kind}-month-previous" aria-label="Poprzedni miesiąc">←</button><div><p>WYBRANY MIESIĄC</p><input class="month-picker" type="month" data-month-picker="${kind}" value="${selected}" max="${currentMonthKey()}" aria-label="Wybierz miesiąc" /><small>${escapeHtml(noun)} w wybranym okresie</small></div><button class="month-button" type="button" data-action="${kind}-month-next" ${hasNewerMonth ? "" : "disabled"} aria-label="Następny miesiąc">→</button></section>`;
}

function contractRow(row) {
  return `<tr><td><button class="table-link" type="button" data-contract-id="${row.id}">${escapeHtml(row.name)}</button><small>${escapeHtml(row.client || "—")}</small></td><td>${escapeHtml(row.trade || "—")}</td><td class="money">${money(row.value_cents)}</td><td class="contract-progress"><strong>${row.baseline_progress}%</strong><div class="progress"><span style="width:${clampProgress(row.baseline_progress)}%"></span></div></td><td>${date(row.due_date)}</td><td>${statusTag(row.status)}</td></tr>`;
}
function contractListRow(row) {
  return `${contractRow(row).replace("</tr>", `<td><button class="table-action" type="button" data-contract-id="${row.id}">Otwórz</button></td></tr>`)}`;
}
function reportContractRow(row) {
  return `<tr><td><button class="table-link" type="button" data-contract-id="${row.id}">${escapeHtml(row.name)}</button><small>${escapeHtml(row.client || "—")}</small></td><td class="money">${money(row.value_cents)}</td><td class="money">${money(row.budget_cents)}</td><td>${row.baseline_progress}%</td><td>${statusTag(row.status)}</td></tr>`;
}
function settlementRow(row) {
  return `<tr><td>${date(row.settlement_date)}<small>okres: ${date(row.period)}</small></td><td><strong>${escapeHtml(relationName(row.contracts))}</strong></td><td>${escapeHtml(kindLabel(row.kind))}</td><td>${escapeHtml(row.reference_number || row.budget_category || "—")}</td><td class="money">${money(row.net_amount_cents)}</td><td>${statusTag(row.status)}</td></tr>`;
}
function invoiceRow(row) {
  const assignment = row.allocation === "contract" ? relationName(row.contracts) : row.allocation === "company" ? row.company_category : "Nieprzypisana";
  const controls = canManageFinance() ? `<button class="table-action" type="button" data-action="edit-invoice" data-id="${row.id}">Edytuj</button><button class="table-action danger" type="button" data-action="delete-invoice" data-id="${row.id}">Usuń</button>` : "";
  return `<tr><td><strong>${escapeHtml(row.document_number)}</strong><small>${row.source === "ksef" ? "KSeF" : "Ręczna"}</small></td><td>${escapeHtml(row.counterparty)}</td><td>${date(row.issue_date)}</td><td>${row.invoice_type === "sales" ? "Sprzedażowa" : "Zakupowa"}</td><td>${escapeHtml(assignment || "—")}</td><td class="money">${money(row.net_amount_cents)}</td><td>${statusTag(row.payment_status)}</td><td class="row-actions">${controls}</td></tr>`;
}
function costRow(row) {
  const controls = canManageFinance() ? `<button class="table-action" type="button" data-action="edit-cost" data-id="${row.id}">Edytuj</button><button class="table-action danger" type="button" data-action="delete-cost" data-id="${row.id}">Usuń</button>` : "";
  return `<tr><td>${date(row.cost_date)}</td><td>${escapeHtml(costCategoryLabel(row.category))}</td><td><strong>${escapeHtml(row.description || "—")}</strong></td><td>${escapeHtml(row.vendor || "—")}</td><td>${escapeHtml(row.document_number || "—")}</td><td class="money">${money(row.net_amount_cents)}</td><td>${statusTag(row.payment_status)}</td><td class="row-actions">${controls}</td></tr>`;
}
function detailSettlementRow(row) {
  const controls = canManageContracts() ? `${row.status === "do_akceptacji" ? `<button class="table-action" type="button" data-action="approve-settlement" data-id="${row.id}">Akceptuj</button>` : ""}<button class="table-action" type="button" data-action="edit-settlement" data-id="${row.id}">Edytuj</button><button class="table-action danger" type="button" data-action="delete-settlement" data-id="${row.id}">Usuń</button>` : "";
  return `<tr><td>${date(row.settlement_date)}</td><td>${escapeHtml(kindLabel(row.kind))}</td><td>${escapeHtml(row.reference_number || row.budget_category || "—")}</td><td class="money">${money(row.net_amount_cents)}</td><td>${statusTag(row.status)}</td><td class="row-actions">${controls}</td></tr>`;
}
function detailInvoiceRow(row) {
  const controls = canManageFinance() ? `<button class="table-action" type="button" data-action="edit-invoice" data-id="${row.id}">Edytuj</button><button class="table-action danger" type="button" data-action="delete-invoice" data-id="${row.id}">Usuń</button>` : "";
  const retention = row.invoice_type === "sales" ? retentionAmount(row.net_amount_cents, state.contractDetail?.retention_percent) : 0;
  return `<tr><td><strong>${escapeHtml(row.document_number)}</strong><small>${date(row.issue_date)}</small></td><td>${escapeHtml(row.counterparty)}</td><td>${row.invoice_type === "sales" ? "Sprzedażowa" : "Zakupowa"}</td><td class="money">${money(row.net_amount_cents)}</td><td class="money">${row.invoice_type === "sales" ? money(retention) : "—"}</td><td>${statusTag(row.payment_status)}</td><td class="row-actions">${controls}</td></tr>`;
}
function changeRow(row) {
  const controls = canManageContracts() ? `${row.status === "otwarte" ? `<button class="table-action" type="button" data-action="approve-change" data-id="${row.id}">Akceptuj</button><button class="table-action danger" type="button" data-action="reject-change" data-id="${row.id}">Odrzuć</button>` : ""}<button class="table-action" type="button" data-action="edit-change" data-id="${row.id}">Edytuj</button><button class="table-action danger" type="button" data-action="delete-change" data-id="${row.id}">Usuń</button>` : "";
  return `<tr><td>${escapeHtml(changeKindLabel(row.kind))}</td><td><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.description || "—")}</small></td><td class="money">${money(row.net_amount_cents)}</td><td>${date(row.due_date)}</td><td>${statusTag(row.status)}</td><td class="row-actions">${controls}</td></tr>`;
}
function scheduleRow(row) {
  const controls = canManageContracts() ? `<button class="table-action" type="button" data-action="edit-schedule" data-id="${row.id}">Edytuj</button><button class="table-action danger" type="button" data-action="delete-schedule" data-id="${row.id}">Usuń</button>` : "";
  const term = row.start_date || row.end_date ? `${date(row.start_date)}${row.end_date ? ` — ${date(row.end_date)}` : ""}` : "—";
  const predecessor = scheduleDependencyName(row);
  const subtitle = [row.is_milestone ? "Kamień milowy" : "", predecessor ? `Po: ${predecessor}` : "", row.notes || ""].filter(Boolean).join(" · ") || "—";
  return `<tr><td><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(subtitle)}</small></td><td>${term}</td><td>${escapeHtml(row.responsible || "—")}</td><td class="schedule-progress"><strong>${clampProgress(row.progress)}%</strong><div class="progress"><span style="width:${clampProgress(row.progress)}%"></span></div></td><td>${statusTag(row.status)}</td><td class="row-actions">${controls}</td></tr>`;
}
function importRunRow(row) {
  const message = row.error_message || (row.status === "completed" ? "Import zakończony" : row.status === "queued" ? "Oczekuje na wykonanie" : "—");
  return `<tr><td>${dateTime(row.created_at)}</td><td>${row.environment === "production" ? "Produkcja" : "Test"}</td><td>${importRunTag(row.status)}</td><td>${Number(row.imported_count || 0)}</td><td>${Number(row.skipped_count || 0)}</td><td><small>${escapeHtml(message)}</small></td></tr>`;
}
function alertRow(row) {
  const action = row.contractId
    ? `<button class="table-action" type="button" data-contract-id="${row.contractId}">Otwórz kontrakt</button>`
    : row.view ? `<button class="table-action" type="button" data-view="${row.view}">${escapeHtml(row.actionLabel || "Otwórz")}</button>` : "";
  return `<article class="alert-row alert-${row.severity}"><span class="alert-marker">${row.severity === "critical" ? "!" : row.severity === "warning" ? "!" : "i"}</span><div class="alert-copy"><div><span class="tag tag-${row.severity === "critical" ? "red" : row.severity === "warning" ? "yellow" : "blue"}">${escapeHtml(alertSeverityLabel(row.severity))}</span><strong>${escapeHtml(row.title)}</strong></div><p>${escapeHtml(row.message)}</p></div><div class="row-actions">${action}</div></article>`;
}

function renderGantt(rows) {
  const dated = rows.filter((row) => row.start_date || row.end_date);
  if (!dated.length) return `<div class="gantt-empty">Dodaj daty rozpoczęcia i zakończenia, aby zobaczyć wykres Gantta.</div>`;
  const startDays = dated.map((row) => dayNumber(row.start_date || row.end_date));
  const endDays = dated.map((row) => dayNumber(row.end_date || row.start_date));
  const firstDay = Math.min(...startDays);
  const lastDay = Math.max(...endDays);
  const range = Math.max(lastDay - firstDay + 1, 1);
  return `<div class="gantt"><div class="gantt-scale"><span>${date(dayToIso(firstDay))}</span><span>${date(dayToIso(lastDay))}</span></div><div class="gantt-list">${dated.map((row) => ganttRow(row, firstDay, range)).join("")}</div></div>`;
}
function ganttRow(row, firstDay, range) {
  const start = dayNumber(row.start_date || row.end_date);
  const end = dayNumber(row.end_date || row.start_date);
  const left = ((start - firstDay) / range) * 100;
  const width = Math.max(((end - start + 1) / range) * 100, 1.4);
  const kind = row.is_milestone ? "milestone" : row.status;
  return `<div class="gantt-row"><div class="gantt-name"><strong>${escapeHtml(row.title)}</strong><small>${row.is_milestone ? "Kamień milowy" : `${clampProgress(row.progress)}%`}</small></div><div class="gantt-track"><span class="gantt-bar gantt-${escapeHtml(kind)}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${escapeHtml(row.title)} · ${clampProgress(row.progress)}%"></span></div></div>`;
}
function documentRow(row) {
  const controls = `<button class="table-action" type="button" data-action="download-document" data-id="${row.id}">Pobierz</button>${canManageContracts() ? `<button class="table-action danger" type="button" data-action="delete-document" data-id="${row.id}">Usuń</button>` : ""}`;
  return `<div class="document-row"><div><strong>${escapeHtml(row.file_name)}</strong><small>${escapeHtml(row.mime_type)} · ${fileSize(row.size_bytes)} · ${dateTime(row.created_at)}</small></div><div class="row-actions">${controls}</div></div>`;
}
function historyRow(row) {
  return `<div class="history-row"><span class="tag tag-blue">${escapeHtml(auditActionLabel(row.action))}</span><time>${dateTime(row.created_at)}</time></div>`;
}
function userRow(row) {
  return `<tr><td><strong>${escapeHtml(row.full_name || "—")}</strong><small>${escapeHtml(row.email)}</small></td><td>${statusTag(row.role)}</td><td>${row.active ? `<span class="tag tag-green">Aktywne</span>` : `<span class="tag tag-red">Oczekuje</span>`}</td><td>${dateTime(row.created_at)}</td><td class="row-actions"><button class="table-action" type="button" data-action="manage-user" data-id="${row.id}">Zmień</button></td></tr>`;
}

function openEntryModal(mode, record = null) {
  if (["contract", "settlement", "change", "document", "schedule"].includes(mode) && !canManageContracts()) return;
  if (["invoice", "cost"].includes(mode) && !canManageFinance()) return;
  if (["invite", "manage-user"].includes(mode) && !isOwner()) return;
  if (["change", "document", "schedule"].includes(mode) && !state.contractDetail?.id) return;
  state.modalMode = mode;
  state.modalRecord = record;
  formError.hidden = true;
  const definitions = formDefinition(mode, record || {});
  modalEyebrow.textContent = definitions.eyebrow;
  modalTitle.textContent = definitions.title;
  modalFields.innerHTML = definitions.fields;
  modal.showModal();
}

function formDefinition(mode, record) {
  const options = (items, selected = "") => items.map(([value, label]) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected || "") ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const selectedContractId = record.contract_id || (state.activeView === "contractDetail" ? state.contractDetail?.id : "");
  const contractRows = [...state.contracts];
  if (state.contractDetail?.id && !contractRows.some((row) => row.id === state.contractDetail.id)) contractRows.push(state.contractDetail);
  const contractSelect = contractRows.length ? options([["", "Wybierz kontrakt"], ...contractRows.map((row) => [row.id, row.name])], selectedContractId) : `<option value="">Najpierw dodaj kontrakt</option>`;
  const schedulePredecessors = state.schedule.filter((row) => row.id !== record.id);
  const dependencySelect = options([["", "Brak zależności"], ...schedulePredecessors.map((row) => [row.id, row.title])], record.depends_on_id || "");
  const today = new Date().toISOString().slice(0, 10);
  const firstDay = `${today.slice(0, 7)}-01`;
  const field = (label, control, className = "") => `<label class="${className}">${label}${control}</label>`;
  const val = (value) => `value="${escapeHtml(value ?? "")}"`;
  const input = (name, type, value = "", extra = "") => `<input name="${name}" type="${type}" ${val(value)} ${extra} />`;
  const select = (name, values, extra = "") => `<select name="${name}" ${extra}>${values}</select>`;
  const moneyValue = (cents) => Number(cents || 0) / 100;
  const moneyInput = (name = "net_amount", value = "") => input(name, "number", value, "min=\"0\" step=\"0.01\" required");
  const statusOptions = (selected = "do_platnosci") => options([["nowa", "Nowa"], ["do_platnosci", "Do płatności"], ["oplacona", "Opłacona"], ["zaksiegowana", "Zaksięgowana"]], selected);

  if (mode === "contract") return {
    eyebrow: record.id ? "EDYCJA KONTRAKTU" : "NOWY KONTRAKT", title: record.id ? "Edytuj kontrakt" : "Dodaj kontrakt", fields: [
      field("Nazwa kontraktu", input("name", "text", record.name, "required"), "full"),
      field("Numer kontraktu", input("contract_number", "text", record.contract_number)),
      field("Klient", input("client", "text", record.client, "required")),
      field("Branża", select("trade", options([["elektryczna", "Elektryczna"], ["teletechniczna", "Teletechniczna"], ["mieszana", "Mieszana"]], record.trade || "elektryczna"))),
      field("Wartość netto (zł)", moneyInput("value", record.id ? moneyValue(record.value_cents) : "")),
      field("Budżet kosztów netto (zł)", moneyInput("budget", record.id ? moneyValue(record.budget_cents) : "")),
      field("Zaawansowanie bazowe (%)", input("baseline_progress", "number", record.id ? record.baseline_progress : 0, "min=\"0\" max=\"100\" required")),
      field("Termin umowny", input("due_date", "date", record.due_date)),
      field("Kaucja gwarancyjna (%)", input("retention_percent", "number", record.id ? record.retention_percent ?? 0 : 0, "min=\"0\" max=\"100\" step=\"0.01\" required")),
      field("Status", select("status", options([["w_realizacji", "W realizacji"], ["do_decyzji", "Do decyzji"], ["ryzyko", "Ryzyko"], ["zakonczony", "Zakończony"]], record.status || "w_realizacji"))),
      field("Opis / zakres", `<textarea name="description" placeholder="Zakres prac, ważne ustalenia…">${escapeHtml(record.description || "")}</textarea>`, "full"),
    ].join("")
  };
  if (mode === "settlement") return {
    eyebrow: record.id ? "EDYCJA ROZLICZENIA" : "ROZLICZENIE KONTRAKTU", title: record.id ? "Edytuj rozliczenie" : "Dodaj rozliczenie", fields: [
      field("Kontrakt", select("contract_id", contractSelect, "required"), "full"),
      field("Okres", input("period", "date", record.period || firstDay, "required")),
      field("Data rozliczenia", input("settlement_date", "date", record.settlement_date || today, "required")),
      field("Rodzaj", select("kind", options([["przerob", "Przerób"], ["faktura", "Faktura"], ["koszt", "Koszt"], ["platnosc", "Płatność"], ["zaliczka", "Zaliczka"], ["korekta", "Korekta"]], record.kind || "przerob"))),
      field("Kwota netto (zł)", moneyInput("net_amount", record.id ? moneyValue(record.net_amount_cents) : "")),
      field("VAT (%)", input("vat_rate", "number", record.vat_rate ?? 23, "min=\"0\" max=\"100\" step=\"0.01\" required")),
      field("Numer / opis", input("reference_number", "text", record.reference_number)),
      field("Kategoria budżetowa", input("budget_category", "text", record.budget_category || "pozostałe")),
      field("Status", select("status", options([["robocze", "Robocze"], ["do_akceptacji", "Do akceptacji"], ["zafakturowane", "Zafakturowane"], ["oplacone", "Opłacone"]], record.status || "robocze"))),
    ].join("")
  };
  if (mode === "invoice") return {
    eyebrow: record.id ? "EDYCJA FAKTURY" : "REJESTR FAKTUR", title: record.id ? "Edytuj fakturę" : "Dodaj fakturę", fields: [
      field("Typ faktury", select("invoice_type", options([["purchase", "Zakupowa"], ["sales", "Sprzedażowa"]], record.invoice_type || "purchase"))),
      field("Źródło", select("source", options([["manual", "Ręczna"], ["ksef", "KSeF"]], record.source || "manual"))),
      field("Numer dokumentu", input("document_number", "text", record.document_number, "required")),
      field("Kontrahent", input("counterparty", "text", record.counterparty, "required")),
      field("Data wystawienia", input("issue_date", "date", record.issue_date || today, "required")),
      field("Termin płatności", input("due_date", "date", record.due_date)),
      field("Kwota netto (zł)", moneyInput("net_amount", record.id ? moneyValue(record.net_amount_cents) : "")),
      field("VAT (%)", input("vat_rate", "number", record.vat_rate ?? 23, "min=\"0\" max=\"100\" step=\"0.01\" required")),
      field("Przypisanie", select("allocation", options([["unassigned", "Do przypisania"], ["contract", "Kontrakt"], ["company", "Koszt firmowy"]], record.allocation || (state.activeView === "contractDetail" ? "contract" : "unassigned")))),
      field("Kontrakt (gdy przypisanie: kontrakt)", select("contract_id", contractSelect)),
      field("Kategoria firmowa (gdy koszt firmowy)", input("company_category", "text", record.company_category)),
      field("Status płatności", select("payment_status", statusOptions(record.payment_status || "do_platnosci"))),
    ].join("")
  };
  if (mode === "cost") return {
    eyebrow: record.id ? "EDYCJA KOSZTU" : "KOSZTY FIRMOWE", title: record.id ? "Edytuj koszt firmowy" : "Dodaj koszt firmowy", fields: [
      field("Data kosztu", input("cost_date", "date", record.cost_date || today, "required")),
      field("Kategoria", select("category", options([["paliwo", "Paliwo"], ["narzedzia", "Narzędzia"], ["ubior_bhp", "Ubiór BHP"], ["najem_lokali", "Najem lokali"], ["pozostale", "Pozostałe"]], normalizeCostCategory(record.category || "paliwo")))),
      field("Opis", `<textarea name="description" placeholder="Np. najem biura — wrzesień">${escapeHtml(record.description || "")}</textarea>`, "full"),
      field("Dostawca", input("vendor", "text", record.vendor)),
      field("Numer dokumentu", input("document_number", "text", record.document_number)),
      field("Kwota netto (zł)", moneyInput("net_amount", record.id ? moneyValue(record.net_amount_cents) : "")),
      field("VAT (%)", input("vat_rate", "number", record.vat_rate ?? 23, "min=\"0\" max=\"100\" step=\"0.01\" required")),
      field("Status płatności", select("payment_status", statusOptions(record.payment_status || "do_platnosci"))),
    ].join("")
  };
  if (mode === "change") return {
    eyebrow: record.id ? "EDYCJA DECYZJI" : "ZMIANA / ROSZCZENIE / RYZYKO", title: record.id ? "Edytuj pozycję" : "Dodaj pozycję", fields: [
      field("Rodzaj", select("kind", options([["zmiana", "Zmiana"], ["roszczenie", "Roszczenie"], ["ryzyko", "Ryzyko"]], record.kind || "zmiana"))),
      field("Termin decyzji", input("due_date", "date", record.due_date)),
      field("Tytuł", input("title", "text", record.title, "required"), "full"),
      field("Opis", `<textarea name="description" placeholder="Opis wpływu, ustaleń oraz kolejny krok…">${escapeHtml(record.description || "")}</textarea>`, "full"),
      field("Wpływ netto (zł; minus oznacza koszt / ryzyko)", input("net_amount", "number", record.id ? moneyValue(record.net_amount_cents) : 0, "step=\"0.01\" required")),
    ].join("")
  };
  if (mode === "schedule") return {
    eyebrow: record.id ? "EDYCJA HARMONOGRAMU" : "HARMONOGRAM KONTRAKTU", title: record.id ? "Edytuj zadanie" : "Dodaj zadanie", fields: [
      field("Nazwa zadania / etapu", input("title", "text", record.title, "required"), "full"),
      field("Data rozpoczęcia", input("start_date", "date", record.start_date)),
      field("Termin zakończenia", input("end_date", "date", record.end_date)),
      field("Odpowiedzialny", input("responsible", "text", record.responsible)),
      field("Postęp (%)", input("progress", "number", record.id ? record.progress : 0, "min=\"0\" max=\"100\" required")),
      field("Status", select("status", options([["planowany", "Planowane"], ["w_realizacji", "W realizacji"], ["zakonczony", "Zakończone"], ["opozniony", "Opóźnione"]], record.status || "planowany"))),
      field("Zależy po zadaniu", select("depends_on_id", dependencySelect)),
      `<label class="check-field"><input name="is_milestone" type="checkbox" ${record.is_milestone ? "checked" : ""} />Kamień milowy</label>`,
      field("Uwagi", `<textarea name="notes" placeholder="Zależności, materiały, ryzyka lub kolejny krok…">${escapeHtml(record.notes || "")}</textarea>`, "full"),
    ].join("")
  };
  if (mode === "document") return { eyebrow: "DOKUMENT KONTRAKTU", title: "Dodaj dokument", fields: field("Plik (PDF, JPG, PNG lub XLSX; maks. 10 MB)", `<input name="file" type="file" accept="application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />`, "full") };
  if (mode === "invite") return { eyebrow: "NOWE KONTO", title: "Utwórz konto użytkownika", fields: [
      field("Imię i nazwisko", input("full_name", "text", "", "required")),
      field("Firmowy e-mail", input("email", "email", "", "autocomplete=\"off\" required")),
      field("Hasło tymczasowe (min. 10 znaków)", input("password", "password", "", "minlength=\"10\" autocomplete=\"new-password\" required")),
      field("Rola", select("role", options([["manager", "Kierownik kontraktu"], ["accountant", "Księgowość"], ["viewer", "Podgląd"]], "viewer"))),
    ].join("") };
  return { eyebrow: "UPRAWNIENIA", title: "Zmień konto użytkownika", fields: [
    field("Imię i nazwisko", input("full_name", "text", record.full_name, "required")),
    field("Firmowy e-mail", input("email", "email", record.email, "disabled")),
    field("Rola", select("role", options([["owner", "Właściciel"], ["manager", "Kierownik kontraktu"], ["accountant", "Księgowość"], ["viewer", "Podgląd"]], record.role))),
    field("Dostęp", select("active", options([["true", "Aktywne"], ["false", "Wyłączone"]], String(record.active)))),
  ].join("") };
}

entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const supabase = state.supabase;
  const form = new FormData(entryForm);
  const mode = state.modalMode;
  const record = state.modalRecord;
  const submit = entryForm.querySelector("button[type=submit]");
  formError.hidden = true;
  try {
    submit.disabled = true;
    submit.textContent = "Zapisywanie…";
    if (mode === "document") await saveDocument(form);
    else if (mode === "invite") await createUser(form);
    else if (mode === "manage-user") await updateUser(form, record);
    else {
      const { table, payload } = formPayload(mode, form);
      const query = record?.id
        ? supabase.from(table).update(payload).eq("id", record.id)
        : supabase.from(table).insert({ ...payload, created_by: state.user.id });
      const { error } = await query;
      if (error) throw error;
    }
    modal.close();
    state.modalRecord = null;
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

async function saveDocument(form) {
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new Error("Wybierz plik do wysłania.");
  if (file.size > 10485760) throw new Error("Plik jest większy niż dozwolone 10 MB.");
  const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
  if (!allowedTypes.includes(file.type)) throw new Error("Dozwolone są wyłącznie pliki PDF, JPG, PNG i XLSX.");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "dokument";
  const unique = globalThis.crypto?.randomUUID?.() || String(Date.now());
  const storagePath = `${state.contractDetail.id}/${unique}-${safeName}`;
  const { error: uploadError } = await state.supabase.storage.from("contract-documents").upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;
  const { error: recordError } = await state.supabase.from("contract_documents").insert({
    contract_id: state.contractDetail.id,
    file_name: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    size_bytes: file.size,
    uploaded_by: state.user.id,
  });
  if (recordError) {
    await state.supabase.storage.from("contract-documents").remove([storagePath]);
    throw recordError;
  }
}

async function createUser(form) {
  const { data, error } = await state.supabase.functions.invoke("admin-users", {
    body: { fullName: String(form.get("full_name") || "").trim(), email: String(form.get("email") || "").trim(), password: String(form.get("password") || ""), role: String(form.get("role") || "viewer") },
  });
  if (error || data?.error) throw new Error(data?.error || error?.message || "Nie udało się utworzyć konta.");
}

async function updateUser(form, record) {
  if (!record?.id) throw new Error("Nie wybrano użytkownika.");
  const active = String(form.get("active")) === "true";
  if (record.id === state.user.id && !active) throw new Error("Nie możesz wyłączyć własnego konta.");
  const { error } = await state.supabase.from("profiles").update({
    full_name: String(form.get("full_name") || "").trim(),
    role: String(form.get("role") || "viewer"),
    active,
  }).eq("id", record.id);
  if (error) throw error;
}

function formPayload(mode, form) {
  const value = (key) => String(form.get(key) || "").trim();
  const number = (key) => toCents(value(key));
  const vat = () => Number(value("vat_rate") || 0);
  if (mode === "contract") {
    const retentionPercent = Number(value("retention_percent"));
    if (!Number.isFinite(retentionPercent) || retentionPercent < 0 || retentionPercent > 100) throw new Error("Kaucja gwarancyjna musi mieścić się w zakresie 0–100%.");
    return { table: "contracts", payload: { name: value("name"), contract_number: value("contract_number"), client: value("client"), trade: value("trade"), description: value("description"), value_cents: number("value"), budget_cents: number("budget"), baseline_progress: Number(value("baseline_progress")), due_date: value("due_date") || null, retention_percent: retentionPercent, status: value("status") } };
  }
  if (mode === "settlement") return { table: "settlements", payload: { contract_id: value("contract_id"), period: value("period"), settlement_date: value("settlement_date"), kind: value("kind"), net_amount_cents: number("net_amount"), vat_rate: vat(), reference_number: value("reference_number"), budget_category: value("budget_category") || "pozostale", status: value("status") } };
  if (mode === "invoice") {
    const allocation = value("allocation");
    const contractId = value("contract_id");
    const category = value("company_category");
    if (allocation === "contract" && !contractId) throw new Error("Wybierz kontrakt dla tego przypisania.");
    if (allocation === "company" && !category) throw new Error("Podaj kategorię kosztu firmowego.");
    return { table: "invoices", payload: { invoice_type: value("invoice_type"), source: value("source"), document_number: value("document_number"), counterparty: value("counterparty"), issue_date: value("issue_date"), due_date: value("due_date") || null, net_amount_cents: number("net_amount"), vat_rate: vat(), allocation, contract_id: allocation === "contract" ? contractId : null, company_category: allocation === "company" ? category : null, payment_status: value("payment_status") } };
  }
  if (mode === "cost") return { table: "company_costs", payload: { cost_date: value("cost_date"), category: value("category"), description: value("description"), vendor: value("vendor"), document_number: value("document_number"), net_amount_cents: number("net_amount"), vat_rate: vat(), payment_status: value("payment_status") } };
  if (mode === "change") return { table: "contract_changes", payload: { contract_id: state.contractDetail.id, kind: value("kind"), title: value("title"), description: value("description"), net_amount_cents: toSignedCents(value("net_amount")), due_date: value("due_date") || null } };
  if (mode === "schedule") {
    const startDate = value("start_date") || null;
    const endDate = value("end_date") || null;
    const predecessorId = value("depends_on_id") || null;
    if (startDate && endDate && endDate < startDate) throw new Error("Termin zakończenia nie może być wcześniejszy niż data rozpoczęcia.");
    if (state.modalRecord?.id && createsScheduleCycle(state.modalRecord.id, predecessorId)) throw new Error("Ta zależność utworzyłaby zamkniętą pętlę w harmonogramie.");
    return { table: "contract_schedule_items", payload: { contract_id: state.contractDetail.id, title: value("title"), start_date: startDate, end_date: endDate, responsible: value("responsible"), progress: Number(value("progress")), status: value("status"), depends_on_id: predecessorId, is_milestone: form.get("is_milestone") === "on", notes: value("notes") } };
  }
  throw new Error("Nieprawidłowy formularz.");
}

async function handleAction(element) {
  const action = element.dataset.action;
  const id = element.dataset.id;
  try {
    if (["invoice-month-previous", "invoice-month-next", "cost-month-previous", "cost-month-next"].includes(action)) {
      const isInvoice = action.startsWith("invoice-");
      const stateKey = isInvoice ? "invoiceMonth" : "costMonth";
      const direction = action.endsWith("previous") ? -1 : 1;
      const nextMonth = shiftMonth(state[stateKey] || currentMonthKey(), direction);
      if (nextMonth <= currentMonthKey()) state[stateKey] = nextMonth;
      return await loadView(state.supabase);
    }
    if (action === "edit-contract") return openEntryModal("contract", state.contractDetail);
    if (action === "delete-contract") return await deleteContract();
    if (action === "manage-user") {
      const user = state.users.find((row) => row.id === id);
      if (user) openEntryModal("manage-user", user);
      return;
    }
    const editable = {
      "edit-settlement": ["settlement", state.settlements],
      "edit-invoice": ["invoice", state.invoices],
      "edit-cost": ["cost", state.costs],
      "edit-change": ["change", state.changes],
      "edit-schedule": ["schedule", state.schedule],
    }[action];
    if (editable) {
      const record = editable[1].find((row) => row.id === id);
      if (record) openEntryModal(editable[0], record);
      return;
    }
    if (action === "print-report") return window.print();
    if (action === "export-report") return exportReportCsv();
    if (action === "import-ksef-test") return await requestKsefImport("test");
    if (action === "import-ksef-production") {
      if (!window.confirm("Uruchomić import KSeF dla środowiska produkcyjnego? Zostanie zarejestrowana próba importu po stronie Supabase.")) return;
      return await requestKsefImport("production");
    }
    if (action === "download-document") return await downloadDocument(id);

    if (action === "approve-settlement") {
      if (!canManageContracts()) throw new Error("Brak uprawnień do akceptacji rozliczenia.");
      const { error } = await state.supabase.from("settlements").update({ status: "zafakturowane", approved_at: new Date().toISOString(), approved_by: state.user.id }).eq("id", id);
      if (error) throw error;
      return await loadView(state.supabase);
    }
    if (action === "approve-change" || action === "reject-change") {
      if (!canManageContracts()) throw new Error("Brak uprawnień do podjęcia decyzji.");
      const { error } = await state.supabase.from("contract_changes").update({
        status: action === "approve-change" ? "zaakceptowane" : "odrzucone",
        decided_at: new Date().toISOString(),
        decided_by: state.user.id,
      }).eq("id", id);
      if (error) throw error;
      return await loadView(state.supabase);
    }

    const deletion = {
      "delete-settlement": ["settlements", "rozliczenie", canManageContracts()],
      "delete-invoice": ["invoices", "fakturę", canManageFinance()],
      "delete-cost": ["company_costs", "koszt firmowy", canManageFinance()],
      "delete-change": ["contract_changes", "pozycję decyzji", canManageContracts()],
      "delete-schedule": ["contract_schedule_items", "zadanie harmonogramu", canManageContracts()],
    }[action];
    if (deletion) {
      if (!deletion[2]) throw new Error("Brak uprawnień do usunięcia pozycji.");
      if (!window.confirm(`Czy na pewno usunąć ${deletion[1]}? Tej operacji nie można cofnąć.`)) return;
      const { error } = await state.supabase.from(deletion[0]).delete().eq("id", id);
      if (error) throw error;
      return await loadView(state.supabase);
    }
    if (action === "delete-document") return await deleteDocument(id);
  } catch (error) {
    window.alert(error.message || "Nie udało się wykonać operacji.");
  }
}

async function downloadDocument(id) {
  const document = state.documents.find((row) => row.id === id);
  if (!document) throw new Error("Nie znaleziono dokumentu.");
  const { data, error } = await state.supabase.storage.from("contract-documents").createSignedUrl(document.storage_path, 60);
  if (error) throw error;
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

async function deleteDocument(id) {
  if (!canManageContracts()) throw new Error("Brak uprawnień do usunięcia dokumentu.");
  const document = state.documents.find((row) => row.id === id);
  if (!document) throw new Error("Nie znaleziono dokumentu.");
  if (!window.confirm(`Czy na pewno usunąć dokument „${document.file_name}”?`)) return;
  const { error: storageError } = await state.supabase.storage.from("contract-documents").remove([document.storage_path]);
  if (storageError) throw storageError;
  const { error } = await state.supabase.from("contract_documents").delete().eq("id", id);
  if (error) throw error;
  return await loadView(state.supabase);
}

async function deleteContract() {
  if (!canManageContracts()) throw new Error("Brak uprawnień do usunięcia kontraktu.");
  const contract = state.contractDetail;
  if (!contract?.id) throw new Error("Nie wybrano kontraktu.");
  const message = `Czy na pewno usunąć kontrakt „${contract.name}”? Usunięte zostaną jego rozliczenia, zmiany i dokumenty. Faktury pozostaną w rejestrze jako nieprzypisane.`;
  if (!window.confirm(message)) return;
  if (state.documents.length) {
    const { error: storageError } = await state.supabase.storage.from("contract-documents").remove(state.documents.map((row) => row.storage_path));
    if (storageError) throw storageError;
  }
  const { error } = await state.supabase.from("contracts").delete().eq("id", contract.id);
  if (error) throw error;
  state.contractDetail = null;
  state.activeView = "contracts";
  renderShell(state.supabase);
  await loadView(state.supabase);
}

async function requestKsefImport(environment = "test") {
  if (!canManageFinance()) throw new Error("Brak uprawnień do importu KSeF.");
  const { data, error } = await state.supabase.functions.invoke("import-ksef", { body: { environment } });
  if (error || data?.error) throw new Error(data?.error || error?.message || "Nie udało się uruchomić importu KSeF.");
  window.alert(data?.message || "Zlecono sprawdzenie połączenia KSeF.");
  await loadView(state.supabase);
}

function exportReportCsv() {
  const rows = [
    ["Kontrakt", "Klient", "Branża", "Wartość netto", "Budżet netto", "Postęp (%)", "Termin", "Status"],
    ...state.contracts.map((row) => [row.name, row.client || "", row.trade || "", (Number(row.value_cents || 0) / 100).toFixed(2), (Number(row.budget_cents || 0) / 100).toFixed(2), String(row.baseline_progress || 0), row.due_date || "", statusText(row.status)]),
  ];
  const csv = `\ufeff${rows.map((row) => row.map(csvValue).join(";")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `PradPlan-raport-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function collectAlerts({ contracts, settlements, invoices, schedule, changes }) {
  const alerts = [];
  const today = new Date().toISOString().slice(0, 10);
  const soon = addDays(today, 14);
  const contractById = new Map(contracts.map((row) => [row.id, row]));
  const add = (severity, title, message, contractId = null, view = "") => alerts.push({ id: `${severity}-${alerts.length}`, severity, title, message, contractId, view, actionLabel: view === "invoices" ? "Otwórz faktury" : "Otwórz" });

  for (const contract of contracts) {
    if (contract.status === "zakonczony") continue;
    if (contract.due_date && contract.due_date < today) add("critical", "Przekroczony termin kontraktu", `${contract.name} — termin umowny: ${date(contract.due_date)}.`, contract.id);
    else if (contract.due_date && contract.due_date <= soon) add("warning", "Zbliża się termin kontraktu", `${contract.name} — termin umowny: ${date(contract.due_date)}.`, contract.id);

    const settlementCosts = sum(settlements.filter((row) => row.contract_id === contract.id && row.kind === "koszt"), "net_amount_cents");
    const invoiceCosts = sum(invoices.filter((row) => row.contract_id === contract.id && row.invoice_type === "purchase"), "net_amount_cents");
    const costs = settlementCosts + invoiceCosts;
    const budget = Number(contract.budget_cents || 0);
    if (budget > 0 && costs > budget) add("critical", "Przekroczony budżet kontraktu", `${contract.name} — koszty ${money(costs)} przy budżecie ${money(budget)}.`, contract.id);
    else if (budget > 0 && costs >= budget * 0.85) add("warning", "Budżet blisko limitu", `${contract.name} — wykorzystano ${Math.round((costs / budget) * 100)}% budżetu.`, contract.id);
  }

  for (const row of schedule) {
    const contract = contractById.get(row.contract_id);
    const label = contract?.name || "Kontrakt";
    if (row.status === "opozniony" || (row.end_date && row.end_date < today && row.status !== "zakonczony")) add("critical", "Opóźnione zadanie harmonogramu", `${label}: ${row.title}${row.end_date ? ` — termin: ${date(row.end_date)}.` : "."}`, row.contract_id);
    else if (row.end_date && row.end_date <= soon && row.status !== "zakonczony") add("warning", "Zbliża się termin zadania", `${label}: ${row.title} — termin: ${date(row.end_date)}.`, row.contract_id);
  }

  for (const invoice of invoices) {
    if (invoice.allocation === "unassigned") add("warning", "Faktura bez przypisania", `${invoice.document_number || "Faktura"} od ${invoice.counterparty || "kontrahenta"} wymaga przypisania do kontraktu lub kosztów firmy.`, null, "invoices");
    if (invoice.due_date && invoice.due_date < today && !["oplacona", "zaksiegowana"].includes(invoice.payment_status)) add("critical", "Przeterminowana płatność", `${invoice.document_number || "Faktura"} — termin płatności: ${date(invoice.due_date)}.`, invoice.contract_id || null, "invoices");
    else if (invoice.due_date && invoice.due_date <= soon && !["oplacona", "zaksiegowana"].includes(invoice.payment_status)) add("warning", "Zbliża się termin płatności", `${invoice.document_number || "Faktura"} — termin płatności: ${date(invoice.due_date)}.`, invoice.contract_id || null, "invoices");
  }

  for (const row of changes) {
    if (row.status === "otwarte" && row.due_date && row.due_date < today) add("critical", "Przeterminowana decyzja", `${row.title} — termin decyzji: ${date(row.due_date)}.`, row.contract_id);
    else if (row.status === "otwarte" && row.due_date && row.due_date <= soon) add("warning", "Zbliża się termin decyzji", `${row.title} — termin decyzji: ${date(row.due_date)}.`, row.contract_id);
  }
  return alerts.sort((left, right) => ({ critical: 0, warning: 1, info: 2 }[left.severity] - { critical: 0, warning: 1, info: 2 }[right.severity]));
}

function scheduleDependencyName(row) {
  if (!row.depends_on_id) return "";
  return state.schedule.find((item) => item.id === row.depends_on_id)?.title || "poprzednie zadanie";
}
function createsScheduleCycle(recordId, predecessorId) {
  let current = predecessorId;
  const visited = new Set();
  while (current && !visited.has(current)) {
    if (current === recordId) return true;
    visited.add(current);
    current = state.schedule.find((item) => item.id === current)?.depends_on_id || null;
  }
  return false;
}
function dayNumber(value) { return Math.floor(Date.parse(`${value}T12:00:00Z`) / 86400000); }
function dayToIso(day) { return new Date(day * 86400000).toISOString().slice(0, 10); }
function addDays(isoDate, days) { const date = new Date(`${isoDate}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function alertSeverityLabel(severity) { return ({ critical: "Krytyczny", warning: "Ostrzeżenie", info: "Informacja" })[severity] || "Informacja"; }
function importRunTag(status) { const tone = status === "failed" ? "red" : status === "completed" ? "green" : status === "running" ? "blue" : "yellow"; const label = ({ queued: "Oczekuje", running: "W toku", completed: "Zakończony", failed: "Wymaga konfiguracji" })[status] || status; return `<span class="tag tag-${tone}">${label}</span>`; }

function canManageContracts() { return ["owner", "manager"].includes(state.profile?.role); }
function canManageFinance() { return ["owner", "accountant"].includes(state.profile?.role); }
function isOwner() { return state.profile?.role === "owner"; }
function userDisplayName() {
  const profileName = String(state.profile?.full_name || "").trim();
  if (profileName) return profileName;
  const localPart = String(state.profile?.email || state.user?.email || "Użytkownik").split("@")[0];
  return localPart.split(/[._-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || "Użytkownik";
}
function userInitials() {
  const words = userDisplayName().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word.charAt(0)).join("").toUpperCase() || "ET";
}
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
function monthKey(value) { return String(value || "bez-daty").slice(0, 7); }
function groupRowsByMonth(rows, dateField) {
  const groups = new Map();
  for (const row of rows) {
    const key = monthKey(row[dateField]);
    const group = groups.get(key) || { key, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.key.localeCompare(left.key));
}
function selectedMonthKey(stateKey, groups) {
  if (!state[stateKey]) state[stateKey] = groups[0]?.key || currentMonthKey();
  return state[stateKey];
}
function currentMonthKey() { return new Date().toISOString().slice(0, 7); }
function shiftMonth(key, direction) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + direction, 1));
  return date.toISOString().slice(0, 7);
}
function normalizeCostCategory(category) { return ({ najem: "najem_lokali", administracja: "pozostale", inne: "pozostale" })[category] || category || "pozostale"; }
function costCategoryLabel(category) { return ({ paliwo: "Paliwo", narzedzia: "Narzędzia", ubior_bhp: "Ubiór BHP", najem_lokali: "Najem lokali", pozostale: "Pozostałe" })[normalizeCostCategory(category)] || "Pozostałe"; }
function retentionAmount(cents, percent) { return Math.round(Number(cents || 0) * (Number(percent || 0) / 100)); }
function percentLabel(percent) { return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(Number(percent || 0))}%`; }
function monthLabel(key) {
  if (!/^\d{4}-\d{2}$/.test(key)) return "Bez daty";
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 1)));
}
function money(cents) { return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(cents || 0) / 100); }
function date(value) { return value ? new Intl.DateTimeFormat("pl-PL").format(new Date(`${value}T12:00:00`)) : "—"; }
function dateTime(value) { return value ? new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
function fileSize(value) { const bytes = Number(value || 0); if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`; return `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`; }
function toCents(value) { const amount = Number(String(value).replace(",", ".")); if (!Number.isFinite(amount) || amount < 0) throw new Error("Podaj prawidłową kwotę dodatnią lub zero."); return Math.round(amount * 100); }
function toSignedCents(value) { const amount = Number(String(value).replace(",", ".")); if (!Number.isFinite(amount)) throw new Error("Podaj prawidłową kwotę."); return Math.round(amount * 100); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", "\"": "&quot;" })[char]); }
function relationName(relation) { return Array.isArray(relation) ? relation[0]?.name || "—" : relation?.name || "—"; }
function clampProgress(value) { return Math.max(0, Math.min(100, Number(value || 0))); }
function kindLabel(kind) { return ({ przerob: "Przerób", faktura: "Faktura", koszt: "Koszt", platnosc: "Płatność", zaliczka: "Zaliczka", korekta: "Korekta" })[kind] || kind || "—"; }
function changeKindLabel(kind) { return ({ zmiana: "Zmiana", roszczenie: "Roszczenie", ryzyko: "Ryzyko" })[kind] || kind || "—"; }
function auditActionLabel(action) { return ({ insert: "Utworzono", update: "Zmieniono", delete: "Usunięto" })[action] || action || "Zdarzenie"; }
function roleLabel(role) { return ({ owner: "Właściciel", manager: "Kierownik", accountant: "Księgowość", viewer: "Podgląd" })[role] || "Podgląd"; }
function statusText(status) { return ({ w_realizacji: "W realizacji", do_decyzji: "Do decyzji", ryzyko: "Ryzyko", zakonczony: "Zakończony", robocze: "Robocze", do_akceptacji: "Do akceptacji", zafakturowane: "Zafakturowane", oplacona: "Opłacona", nowa: "Nowa", do_platnosci: "Do płatności", zaksiegowana: "Zaksięgowana", otwarte: "Otwarte", zaakceptowane: "Zaakceptowane", odrzucone: "Odrzucone", planowany: "Planowane", opozniony: "Opóźnione", owner: "Właściciel", manager: "Kierownik", accountant: "Księgowość", viewer: "Podgląd" })[status] || String(status || "—"); }
function statusTag(status) { const tone = ["ryzyko", "do_decyzji", "do_akceptacji", "odrzucone", "opozniony"].includes(status) ? "red" : ["w_realizacji", "oplacona", "zaksiegowana", "zakonczony", "zaakceptowane"].includes(status) ? "green" : "blue"; return `<span class="tag tag-${tone}">${escapeHtml(statusText(status))}</span>`; }
