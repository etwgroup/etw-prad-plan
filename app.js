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
const importToast = document.querySelector("#import-toast");
const importToastMessage = document.querySelector("#import-toast-message");
const invoicePreviewModal = document.querySelector("#invoice-preview-modal");
const invoicePreviewContent = document.querySelector("#invoice-preview-content");
const invoiceDeleteModal = document.querySelector("#invoice-delete-modal");
const invoiceDeleteForm = document.querySelector("#invoice-delete-form");
const invoiceDeleteError = document.querySelector("#invoice-delete-error");
const invoiceAllocationModal = document.querySelector("#invoice-allocation-modal");
const invoiceAllocationForm = document.querySelector("#invoice-allocation-form");
const invoiceAllocationTitle = document.querySelector("#invoice-allocation-title");
const invoiceAllocationSummary = document.querySelector("#invoice-allocation-summary");
const invoiceAllocationRows = document.querySelector("#invoice-allocation-rows");
const invoiceAllocationTotal = document.querySelector("#invoice-allocation-total");
const invoiceAllocationError = document.querySelector("#invoice-allocation-error");
const invoiceAttachmentsModal = document.querySelector("#invoice-attachments-modal");
const invoiceAttachmentsContent = document.querySelector("#invoice-attachments-content");
// Maks. 8 krótkich pakietów po 28 XML-i. Wystarcza dla 200 dokumentów
// (100 zakupowych i 100 sprzedażowych) bez długiego pojedynczego wywołania.
const MAX_KSEF_DETAIL_BATCHES = 8;

const viewMeta = {
  dashboard: { label: "Przegląd", icon: "▦" },
  contracts: { label: "Portfel kontraktów", icon: "▦" },
  settlements: { label: "Protokoły przerobowe", icon: "▤" },
  invoices: { label: "Faktury", icon: "▧" },
  costs: { label: "Koszty firmowe", icon: "▱" },
  cashflow: { label: "Płatności i cash flow", icon: "↕" },
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
  invoiceAllocations: [],
  invoiceRules: [],
  invoiceAttachments: [],
  budgetCategories: [],
  costs: [],
  changes: [],
  documents: [],
  schedule: [],
  alerts: [],
  invoiceMonth: "",
  invoiceTypeFilter: "all",
  costMonth: "",
  cashflowMonth: "",
  ksefPreview: [],
  ksefPreviewMonth: "",
  ksefPreviewLimited: false,
  ksefSelectedNumbers: new Set(),
  ksefEnvironment: "demo",
  history: [],
  users: [],
  contractDetail: null,
  modalMode: null,
  modalRecord: null,
  pendingInvoiceDeleteId: null,
  pendingInvoiceAllocationId: null,
  pendingInvoiceAttachmentId: null,
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
          <p class="auth-intro">Prowadź kontrakty elektryczne i teletechniczne. Protokoły przerobowe, faktury oraz koszty firmowe są zawsze w jednym miejscu.</p>
          <div class="auth-features">
            <p><b>✓</b> Kontroluj wartość, termin i postęp kontraktów</p>
            <p><b>✓</b> Dokumentuj protokoły i przypisuj faktury do kontraktów</p>
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
          ${navButton("cashflow")}
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
      const ksefSelection = event.target.closest("[data-ksef-select]");
      if (ksefSelection) {
        const ksefNumber = ksefSelection.dataset.ksefSelect;
        if (ksefNumber) {
          if (ksefSelection.checked) state.ksefSelectedNumbers.add(ksefNumber);
          else state.ksefSelectedNumbers.delete(ksefNumber);
          const page = document.querySelector("#page-content");
          if (page && state.activeView === "invoices") page.innerHTML = renderInvoices();
        }
        return;
      }
      const picker = event.target.closest("[data-month-picker]");
      if (!picker?.value) return;
      const stateKey = ({ invoice: "invoiceMonth", cost: "costMonth", cashflow: "cashflowMonth" })[picker.dataset.monthPicker];
      if (!stateKey) return;
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
      await loadCostsData(supabase);
      page.innerHTML = renderCosts();
    }
    if (state.activeView === "cashflow") {
      await loadCashflowData(supabase);
      page.innerHTML = renderCashflow();
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
  const [contracts, invoices, costs, invoiceAllocations] = await Promise.all([
    selectRows(supabase, "contracts", "id, name, client, trade, contract_number, value_cents, budget_cents, baseline_progress, due_date, status", "created_at", false),
    selectRows(supabase, "invoices", "id, invoice_type, net_amount_cents, allocation, contract_id, company_category", "issue_date", false),
    selectRows(supabase, "company_costs", "id, net_amount_cents", "cost_date", false),
    selectRows(supabase, "invoice_allocations", "id, invoice_id, target_type, contract_id, company_category, budget_category, net_amount_cents", "created_at", false),
  ]);
  state.contracts = contracts;
  state.settlements = [];
  state.invoices = invoices;
  state.invoiceAllocations = invoiceAllocations;
  state.costs = costs;
}

async function loadCashflowData(supabase) {
  const [invoices, costs] = await Promise.all([
    selectRows(supabase, "invoices", "id, invoice_type, document_number, counterparty, issue_date, due_date, paid_at, net_amount_cents, vat_rate, payment_status, allocation, contract_id, company_category, contracts(name)", "due_date", true),
    selectRows(supabase, "company_costs", "id, cost_date, due_date, paid_at, category, description, vendor, document_number, net_amount_cents, vat_rate, payment_status", "due_date", true),
  ]);
  state.invoices = invoices;
  state.costs = costs;
}

async function loadSettlementData(supabase) {
  const [contracts, settlements] = await Promise.all([
    selectRows(supabase, "contracts", "id, name", "name", true),
    selectRows(supabase, "settlements", "id, contract_id, period, settlement_date, kind, net_amount_cents, vat_rate, reference_number, budget_category, contracts(name)", "settlement_date", false),
  ]);
  state.contracts = contracts;
  state.settlements = settlements;
}

async function loadInvoiceData(supabase) {
  const [contracts, invoices, invoiceAllocations, invoiceRules, invoiceAttachments] = await Promise.all([
    selectRows(supabase, "contracts", "id, name, retention_percent", "name", true),
    selectRows(supabase, "invoices", "id, invoice_type, source, document_number, ksef_number, ksef_environment, counterparty, counterparty_nip, ksef_item_summary, issue_date, due_date, paid_at, net_amount_cents, vat_rate, allocation, contract_id, company_category, contract_budget_category, payment_status, contracts(name)", "issue_date", false),
    selectRows(supabase, "invoice_allocations", "id, invoice_id, target_type, contract_id, company_category, budget_category, net_amount_cents", "created_at", false),
    canManageFinance() ? selectRows(supabase, "invoice_assignment_rules", "id, name, active, priority, invoice_type, match_nip, match_text, target_type, contract_id, company_category, contracts(name)", "priority", true) : Promise.resolve([]),
    selectRows(supabase, "invoice_attachments", "id, invoice_id, file_name, storage_path, mime_type, size_bytes, label, ocr_status, created_at", "created_at", false),
  ]);
  state.contracts = contracts;
  state.invoices = invoices;
  state.invoiceAllocations = invoiceAllocations;
  state.invoiceRules = invoiceRules;
  state.invoiceAttachments = invoiceAttachments;
}

async function loadCostsData(supabase) {
  const [costs, invoices, invoiceAllocations] = await Promise.all([
    selectRows(supabase, "company_costs", "id, cost_date, due_date, paid_at, category, description, vendor, document_number, net_amount_cents, vat_rate, payment_status", "cost_date", false),
    selectRows(supabase, "invoices", "id, invoice_type, source, document_number, ksef_number, ksef_environment, counterparty, issue_date, due_date, paid_at, net_amount_cents, vat_rate, allocation, company_category, payment_status", "issue_date", false),
    selectRows(supabase, "invoice_allocations", "id, invoice_id, target_type, company_category, net_amount_cents", "created_at", false),
  ]);
  state.costs = costs;
  state.invoices = invoices;
  state.invoiceAllocations = invoiceAllocations;
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
  const [contracts, settlements, allInvoices, invoiceAllocations, budgetCategories, invoiceAttachments, changes, documents, schedule, history] = await Promise.all([
    selectRows(supabase, "contracts", "id, name, retention_percent", "name", true),
    selectRowsBy(supabase, "settlements", "id, contract_id, period, settlement_date, kind, net_amount_cents, vat_rate, reference_number, budget_category", "contract_id", contractId, "settlement_date", false),
    selectRows(supabase, "invoices", "id, invoice_type, source, document_number, ksef_number, ksef_environment, counterparty, counterparty_nip, ksef_item_summary, issue_date, due_date, paid_at, net_amount_cents, vat_rate, allocation, contract_id, company_category, contract_budget_category, payment_status", "issue_date", false),
    selectRows(supabase, "invoice_allocations", "id, invoice_id, target_type, contract_id, company_category, budget_category, net_amount_cents", "created_at", false),
    selectRowsBy(supabase, "contract_budget_categories", "id, contract_id, category, planned_cents, notes", "contract_id", contractId, "category", true),
    selectRows(supabase, "invoice_attachments", "id, invoice_id, file_name, storage_path, mime_type, size_bytes, label, ocr_status, created_at", "created_at", false),
    selectRowsBy(supabase, "contract_changes", "id, kind, title, description, net_amount_cents, status, due_date, decided_at", "contract_id", contractId, "created_at", false),
    selectRowsBy(supabase, "contract_documents", "id, file_name, storage_path, mime_type, size_bytes, created_at", "contract_id", contractId, "created_at", false),
    selectRowsBy(supabase, "contract_schedule_items", "id, contract_id, title, start_date, end_date, responsible, progress, status, notes, depends_on_id, is_milestone", "contract_id", contractId, "start_date", true),
    loadContractHistory(supabase, contractId),
  ]);
  state.contractDetail = contract;
  state.contracts = contracts;
  state.settlements = settlements;
  state.invoiceAllocations = invoiceAllocations;
  state.budgetCategories = budgetCategories;
  state.invoiceAttachments = invoiceAttachments;
  state.invoices = invoicePortionsForContract(contractId, allInvoices, invoiceAllocations);
  state.changes = changes;
  state.documents = documents;
  state.schedule = schedule;
  state.history = history;
}

async function loadAlertData(supabase) {
  const [contracts, invoices, invoiceAllocations, schedule, changes] = await Promise.all([
    selectRows(supabase, "contracts", "id, name, client, value_cents, budget_cents, due_date, status", "due_date", true),
    selectRows(supabase, "invoices", "id, contract_id, invoice_type, document_number, counterparty, net_amount_cents, allocation, due_date, payment_status", "due_date", true),
    selectRows(supabase, "invoice_allocations", "id, invoice_id, target_type, contract_id, company_category, net_amount_cents", "created_at", false),
    selectRows(supabase, "contract_schedule_items", "id, contract_id, title, end_date, progress, status", "end_date", true),
    selectRows(supabase, "contract_changes", "id, contract_id, kind, title, due_date, status", "due_date", true),
  ]);
  state.contracts = contracts;
  state.settlements = [];
  state.invoices = invoices;
  state.invoiceAllocations = invoiceAllocations;
  state.schedule = schedule;
  state.changes = changes;
  state.alerts = collectAlerts({ contracts, invoices, schedule, changes });
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
  const unassigned = state.invoices.filter(invoiceNeedsResolution);
  return `
    ${heading("PRĄDPLAN / PRZEGLĄD", "Portfel kontraktów", "Jedno miejsce do kontroli kontraktów, faktur i kosztów firmowych.")}
    <section class="metric-grid">
      ${metric("Kontrakty aktywne", String(state.contracts.filter((row) => row.status !== "zakonczony").length), "Portfel bieżący", "yellow")}
      ${metric("Wartość kontraktów", money(contractValue), "Netto", "green")}
      ${metric("Faktury sprzedażowe", money(sum(state.invoices.filter((row) => row.invoice_type === "sales"), "net_amount_cents")), "Przychody z FV", "blue")}
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
    ${heading("ETW GROUP / KONTRAKTY", "Protokoły przerobowe", "Dokumentuj postęp robót. Protokoły nie wpływają na podsumowania finansowe kontraktów.", canAdd ? button("+ Dodaj protokół", "settlement") : "")}
    <section class="metric-grid">
      ${metric("Protokoły", String(state.settlements.length), "Rejestr bieżący", "yellow")}
      ${metric("W tym miesiącu", String(state.settlements.filter((row) => monthKey(row.settlement_date) === currentMonthKey()).length), "Data protokołu", "blue")}
      ${metric("Z numerem", String(state.settlements.filter((row) => row.reference_number).length), "Identyfikowalne", "green")}
      ${metric("Kontrakty", String(state.contracts.length), "Dostępne do wyboru", "blue")}
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Rejestr protokołów przerobowych</h2><p>Każda pozycja dokumentuje wykonanie robót, ale nie zmienia wartości ani kosztów kontraktu.</p></div></div>
      ${state.settlements.length ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Kontrakt</th><th>Protokół</th><th>Opis / nr</th><th>Wartość informacyjna</th></tr></thead><tbody>${state.settlements.map(settlementRow).join("")}</tbody></table></div>` : emptyState("Brak protokołów. Najpierw utwórz kontrakt, a potem dodaj protokół.")}
    </section>`;
}

function renderInvoices() {
  const canAdd = canManageFinance();
  if (state.ksefEnvironment === "production" && !isOwner()) state.ksefEnvironment = "demo";
  const ksefEnvironment = state.ksefEnvironment === "production" ? "production" : "demo";
  const ksefLabel = ksefEnvironmentLabel(ksefEnvironment);
  const productionNotice = ksefEnvironment === "production"
    ? `<p class="ksef-production-notice"><strong>Tryb produkcyjny:</strong> połączenie służy wyłącznie do odczytu i importu do rejestru PrądPlan. Aplikacja nie wystawia ani nie wysyła faktur do KSeF.</p>`
    : "";
  const environmentSwitch = isOwner()
    ? `<div class="ksef-environment-switch" role="group" aria-label="Środowisko KSeF"><button class="ksef-environment-button ${ksefEnvironment === "demo" ? "is-active" : ""}" type="button" data-action="set-ksef-environment" data-ksef-environment="demo">DEMO</button><button class="ksef-environment-button ksef-environment-production ${ksefEnvironment === "production" ? "is-active" : ""}" type="button" data-action="set-ksef-environment" data-ksef-environment="production">PRODUKCJA</button></div>`
    : "";
  const monthlyInvoices = groupRowsByMonth(state.invoices, "issue_date");
  const activeMonth = selectedMonthKey("invoiceMonth", monthlyInvoices);
  const visibleInvoices = activeMonth ? state.invoices.filter((row) => monthKey(row.issue_date) === activeMonth) : [];
  const activeType = ["all", "purchase", "sales"].includes(state.invoiceTypeFilter) ? state.invoiceTypeFilter : "all";
  const filteredInvoices = activeType === "all" ? visibleInvoices : visibleInvoices.filter((row) => row.invoice_type === activeType);
  const unassigned = filteredInvoices.filter(invoiceNeedsResolution);
  const corrections = filteredInvoices.filter(invoiceIsCorrection);
  return `
    ${heading("KSeF / REJESTR FAKTUR", "Faktury", "Faktury zakupowe i sprzedażowe. Każdą pozycję można przypisać do kontraktu lub kosztów firmy.", canAdd ? button("+ Dodaj fakturę", "invoice") : "")}
    ${monthNavigator("invoice", activeMonth, monthlyInvoices, "faktur")}
    <section class="metric-grid invoice-metric-grid">
      ${invoiceAmountMetric("Faktury", filteredInvoices, `${filteredInvoices.length} · ${invoiceTypeFilterLabel(activeType)}`, "yellow")}
      ${invoiceAmountMetric("Zakupowe", visibleInvoices.filter((row) => row.invoice_type === "purchase"), "Koszty z FV", "red")}
      ${invoiceAmountMetric("Sprzedażowe", visibleInvoices.filter((row) => row.invoice_type === "sales"), "Przychody z FV", "green")}
      ${invoiceAmountMetric("Do przypisania", unassigned, `${unassigned.length} pozycji`, "yellow")}
      ${invoiceAmountMetric("Faktury korygujące", corrections, `${corrections.length} nie do rozliczenia`, "blue")}
    </section>
    <section class="ksef-import-card"><div class="ksef-import-intro"><div class="callout-icon">⇩</div><div><p class="eyebrow">${escapeHtml(ksefLabel)}</p><h2>Import faktur</h2><p>Wybierz rodzaj dokumentów za <strong>${escapeHtml(activeMonth ? monthLabel(activeMonth) : "wybrany miesiąc")}</strong>. Duplikaty po numerze KSeF i środowisku zostaną pominięte.</p>${productionNotice}</div></div>${canAdd ? `<div class="ksef-import-actions"><div class="ksef-import-actions-head"><span>ŚRODOWISKO I ZAKRES</span>${environmentSwitch}<button class="text-button" type="button" data-action="test-ksef">Test połączenia</button></div><div class="ksef-import-action-grid"><button class="ksef-import-button ksef-import-sales" type="button" data-action="import-ksef-sales"><span>FV sprzedażowe</span><small>Przychody z kontraktów</small></button><button class="ksef-import-button ksef-import-purchase" type="button" data-action="import-ksef-purchase"><span>FV zakupowe</span><small>Koszty i zakupy firmy</small></button><button class="ksef-import-button ksef-import-all" type="button" data-action="import-ksef-month"><span>Wszystkie FV</span><small>Zakupowe i sprzedażowe</small></button></div></div>` : ""}</section>
    ${invoiceTypeTabs(visibleInvoices, activeType)}
    ${renderInvoiceInbox(unassigned, canAdd, corrections.length)}
    ${renderInvoiceCorrections(corrections)}
    ${renderInvoiceRules(canAdd)}
    <section class="panel">
      <div class="panel-head"><div><h2>${escapeHtml(invoiceTypeFilterTitle(activeType))} — ${escapeHtml(activeMonth ? monthLabel(activeMonth) : "brak miesiąca")}</h2><p>Rozlicz fakturę jednorazowo albo podziel jej kwotę pomiędzy kontrakty i koszty firmowe.</p></div></div>
      ${filteredInvoices.length ? `<div class="table-wrap invoice-table-wrap"><table class="invoice-register-table"><thead><tr><th>Numer</th><th>Kontrahent</th><th>Data wystawienia</th><th>Termin płatności</th><th>Typ</th><th>Przypisanie</th><th>Netto</th><th>Kwota VAT</th><th>Brutto</th><th>Status</th><th></th></tr></thead><tbody>${filteredInvoices.map(invoiceRow).join("")}</tbody></table></div>` : emptyState(invoiceTypeEmptyMessage(activeType))}
    </section>`;
}

function invoiceTypeTabs(rows, activeType) {
  const count = (type) => type === "all" ? rows.length : rows.filter((row) => row.invoice_type === type).length;
  return `<nav class="invoice-type-tabs" aria-label="Rodzaj faktur"><button class="invoice-type-tab ${activeType === "all" ? "is-active" : ""}" type="button" data-action="invoice-type-filter" data-invoice-type="all"><span>Wszystkie</span><strong>${count("all")}</strong></button><button class="invoice-type-tab invoice-type-tab-purchase ${activeType === "purchase" ? "is-active" : ""}" type="button" data-action="invoice-type-filter" data-invoice-type="purchase"><span>FV zakupowe</span><strong>${count("purchase")}</strong></button><button class="invoice-type-tab invoice-type-tab-sales ${activeType === "sales" ? "is-active" : ""}" type="button" data-action="invoice-type-filter" data-invoice-type="sales"><span>FV sprzedażowe</span><strong>${count("sales")}</strong></button></nav>`;
}

function invoiceTypeFilterLabel(type) {
  return ({ all: "Wszystkie faktury", purchase: "FV zakupowe", sales: "FV sprzedażowe" })[type] || "Wszystkie faktury";
}

function ksefEnvironmentLabel(environment = state.ksefEnvironment) {
  return environment === "production" ? "KSeF PRODUKCJA" : "KSeF DEMO";
}

function invoiceSourceLabel(row) {
  return row?.source === "ksef" ? ksefEnvironmentLabel(row.ksef_environment) : "Ręczna";
}

function invoiceTypeFilterTitle(type) {
  return ({ all: "Rejestr wszystkich faktur", purchase: "Rejestr FV zakupowych", sales: "Rejestr FV sprzedażowych" })[type] || "Rejestr faktur";
}

function invoiceTypeEmptyMessage(type) {
  return ({ all: "Brak faktur w wybranym miesiącu.", purchase: "Brak FV zakupowych w wybranym miesiącu.", sales: "Brak FV sprzedażowych w wybranym miesiącu." })[type] || "Brak faktur w wybranym miesiącu.";
}

function renderInvoiceInbox(rows, canManage, correctionCount = 0) {
  const emptyText = correctionCount
    ? "Brak dodatnich faktur do rozliczenia. Faktury korygujące znajdują się w osobnej sekcji poniżej."
    : "Wszystkie faktury z wybranego miesiąca są rozliczone.";
  return `<section class="panel inbox-panel"><div class="panel-head"><div><h2>Do rozliczenia</h2><p>Faktury bez pełnego przypisania. Możesz rozdzielić jedną fakturę na kilka kontraktów lub kategorii firmowych.</p></div>${rows.length ? `<span class="tag tag-yellow">${rows.length} ${rows.length === 1 ? "faktura" : "faktur"}</span>` : `<span class="tag tag-green">Pusto</span>`}</div>${rows.length ? `<div class="table-wrap invoice-table-wrap"><table class="inbox-table"><thead><tr><th>Faktura</th><th>Kontrahent</th><th>Netto FV</th><th>Kwota VAT</th><th>Brutto FV</th><th>Pozostało netto</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr><td data-label="Faktura"><strong>${escapeHtml(row.document_number)}</strong><small>${escapeHtml(invoiceSourceLabel(row))}</small></td><td class="invoice-counterparty-cell" data-label="Kontrahent"><span class="invoice-counterparty" data-tooltip="${escapeHtml(row.counterparty || "Brak kontrahenta")}"><span class="invoice-counterparty-text">${escapeHtml(row.counterparty || "—")}</span></span></td><td data-label="Netto FV" class="money">${money(row.net_amount_cents)}</td><td data-label="Kwota VAT" class="money">${money(vatAmountCents(row))}</td><td data-label="Brutto FV" class="money">${money(grossAmountCents(row))}</td><td data-label="Pozostało netto" class="money">${money(invoiceUnallocatedAmount(row))}</td><td data-label="Akcje" class="row-actions">${invoiceInboxActions(row, canManage)}</td></tr>`).join("")}</tbody></table></div>` : emptyState(emptyText)}</section>`;
}

function invoiceInboxActions(row, canManage) {
  if (!canManage) return "";
  const preview = row.source === "ksef" && row.ksef_number
    ? `<button class="table-action" type="button" data-action="preview-ksef-invoice" data-id="${row.id}">Podgląd</button>`
    : "";
  const scan = row.source !== "ksef"
    ? `<button class="table-action" type="button" data-action="invoice-attachments" data-id="${row.id}">Skan / OCR${invoiceAttachmentCount(row.id) ? ` (${invoiceAttachmentCount(row.id)})` : ""}</button>`
    : "";
  return `${preview}${scan}<button class="table-action" type="button" data-action="allocate-invoice" data-id="${row.id}">Rozlicz</button>`;
}

function renderInvoiceCorrections(rows) {
  if (!rows.length) return "";
  return `<section class="panel invoice-corrections-panel"><div class="panel-head"><div><h2>Faktury korygujące</h2><p>Dokumenty z ujemną kwotą netto. Są widoczne w rejestrze, ale nie wymagają rozliczenia na kontrakt ani koszt firmowy.</p></div><span class="tag tag-blue">${rows.length} ${rows.length === 1 ? "korekta" : "korekty"}</span></div><div class="table-wrap invoice-table-wrap"><table class="invoice-register-table"><thead><tr><th>Numer</th><th>Kontrahent</th><th>Data wystawienia</th><th>Termin płatności</th><th>Typ</th><th>Przypisanie</th><th>Netto</th><th>Kwota VAT</th><th>Brutto</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(invoiceRow).join("")}</tbody></table></div></section>`;
}

function renderInvoiceRules(canManage) {
  if (!canManage) return "";
  const rows = state.invoiceRules || [];
  return `<section class="panel rules-panel"><div class="panel-head"><div><h2>Reguły automatycznego przypisywania</h2><p>Reguły działają tylko podczas kolejnego importu KSeF. Pierwsza pasująca reguła wg priorytetu przypisuje całą nową FV.</p></div>${button("+ Dodaj regułę", "invoice-rule")}</div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Nazwa</th><th>Dopasowanie</th><th>Typ</th><th>Cel</th><th>Priorytet</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(invoiceRuleRow).join("")}</tbody></table></div>` : emptyState("Nie ma jeszcze reguł. Przykład: NIP stałego dostawcy → „Narzędzia” albo fragment opisu pozycji → konkretny kontrakt.")}</section>`;
}

function renderCosts() {
  const canAdd = canManageFinance();
  const categories = ["paliwo", "narzedzia", "ubior_bhp", "najem_lokali", "pozostale"];
  const allCompanyCosts = companyCostEntries();
  const monthlyCosts = groupRowsByMonth(allCompanyCosts, "cost_date");
  const activeMonth = selectedMonthKey("costMonth", monthlyCosts);
  const visibleCosts = activeMonth ? allCompanyCosts.filter((row) => monthKey(row.cost_date) === activeMonth) : [];
  return `
    ${heading("ETW GROUP / FINANSE", "Koszty firmowe", "Ręczne koszty oraz części FV zakupowych rozliczone jako koszt firmowy — bez powiązania z konkretnym kontraktem.", canAdd ? button("+ Dodaj koszt", "cost") : "")}
    ${monthNavigator("cost", activeMonth, monthlyCosts, "kosztów")}
    <section class="metric-grid">
      ${metric("Pozycje", String(visibleCosts.length), activeMonth ? monthLabel(activeMonth) : "Brak danych", "yellow")}
      ${invoiceAmountMetric("Koszty firmowe", visibleCosts, "Netto i brutto", "red")}
      ${metric("Do płatności", String(visibleCosts.filter((row) => row.payment_status === "do_platnosci").length), "Bieżące zobowiązania", "blue")}
      ${metric("Opłacone", String(visibleCosts.filter((row) => row.payment_status === "oplacona").length), "Status płatności", "green")}
    </section>
    <section class="cost-breakdown" aria-label="Podział kosztów firmowych">${categories.map((category) => costCategoryCard(category, visibleCosts)).join("")}</section>
    <section class="panel">
      <div class="panel-head"><div><h2>Rejestr kosztów — ${escapeHtml(activeMonth ? monthLabel(activeMonth) : "brak miesiąca")}</h2><p>Pozycje nie są doliczane do budżetu pojedynczego kontraktu. FV rozliczone częściowo pokazują wyłącznie przypisaną kwotę netto.</p></div></div>
      ${visibleCosts.length ? `<div class="table-wrap invoice-table-wrap"><table class="cost-register-table"><thead><tr><th>Data</th><th>Kategoria</th><th>Opis</th><th>Dostawca</th><th>Dokument</th><th>Źródło</th><th>Netto</th><th>Kwota VAT</th><th>Brutto</th><th>Status</th><th></th></tr></thead><tbody>${visibleCosts.map(companyCostRow).join("")}</tbody></table></div>` : emptyState("Brak kosztów w wybranym miesiącu.")}
    </section>`;
}

function companyCostEntries() {
  const invoices = state.invoices || [];
  const allocations = state.invoiceAllocations || [];
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const invoiceIdsWithSplits = new Set(allocations.map((allocation) => allocation.invoice_id));

  const manualCosts = (state.costs || []).map((cost) => ({
    ...cost,
    entry_type: "manual_cost",
  }));

  const allocatedInvoiceCosts = allocations
    .filter((allocation) => allocation.target_type === "company")
    .map((allocation) => {
      const invoice = invoicesById.get(allocation.invoice_id);
      if (!invoice || invoice.invoice_type !== "purchase" || invoiceIsCorrection(invoice)) return null;
      return invoiceCompanyCostEntry(invoice, allocation.net_amount_cents, allocation.company_category, allocation.id);
    })
    .filter(Boolean);

  // Obsługuje również faktury przypisane w starszym, jednolitym trybie,
  // zanim wprowadzono podział jednej FV na wiele części.
  const directInvoiceCosts = invoices
    .filter((invoice) => invoice.invoice_type === "purchase"
      && !invoiceIsCorrection(invoice)
      && invoice.allocation === "company"
      && !invoiceIdsWithSplits.has(invoice.id))
    .map((invoice) => invoiceCompanyCostEntry(invoice, invoice.net_amount_cents, invoice.company_category));

  return [...manualCosts, ...allocatedInvoiceCosts, ...directInvoiceCosts]
    .sort((left, right) => String(right.cost_date || "").localeCompare(String(left.cost_date || "")));
}

function invoiceCompanyCostEntry(invoice, amountCents, category, allocationId = "") {
  return {
    id: allocationId ? `invoice-allocation:${allocationId}` : `invoice:${invoice.id}`,
    entry_type: "invoice_cost",
    invoice,
    invoice_id: invoice.id,
    cost_date: invoice.issue_date,
    due_date: invoice.due_date,
    paid_at: invoice.paid_at,
    category: normalizeCostCategory(category),
    description: "FV zakupowa rozliczona jako koszt firmowy",
    vendor: invoice.counterparty,
    document_number: invoice.document_number,
    net_amount_cents: Number(amountCents || 0),
    vat_rate: invoice.vat_rate,
    payment_status: invoice.payment_status,
  };
}

function renderCashflow() {
  const cashItems = cashflowItems(state.invoices, state.costs);
  const months = groupRowsByMonth(cashItems, "cash_date");
  // Cash flow always opens on the current month; the user may then freely
  // select a historical or future period in the month navigator.
  const activeMonth = state.cashflowMonth || currentMonthKey();
  if (!state.cashflowMonth) state.cashflowMonth = activeMonth;
  const selectedItems = activeMonth ? cashItems.filter((row) => monthKey(row.cash_date) === activeMonth) : [];
  const outstandingItems = selectedItems.filter((row) => !row.is_paid);
  const plannedIn = sum(outstandingItems.filter((row) => row.direction === "in"), "gross_cents");
  const plannedOut = sum(outstandingItems.filter((row) => row.direction === "out"), "gross_cents");
  const overdue = cashItems.filter((row) => row.cash_date && row.cash_date < todayKey() && !row.is_paid);
  const paidThisMonth = cashItems.filter((row) => row.is_paid && monthKey(row.paid_at) === activeMonth);
  const days = cashflowMonthDays(activeMonth, outstandingItems);
  const actionable = outstandingItems.sort((a, b) => String(a.cash_date).localeCompare(String(b.cash_date)));

  return `
    ${heading("ETW GROUP / FINANSE", "Płatności i cash flow", "Prognoza wpływów oraz wypływów brutto na podstawie terminów faktur i kosztów firmowych.")}
    ${monthNavigator("cashflow", activeMonth, months, "płatności")}
    <section class="metric-grid">
      ${metric("Planowane wpływy", money(plannedIn), activeMonth ? monthLabel(activeMonth) : "Wybrany miesiąc", "green")}
      ${metric("Planowane wypływy", money(plannedOut), "FV zakupowe i koszty firmy", "red")}
      ${metric("Saldo prognozowane", money(plannedIn - plannedOut), "Wpływy − wypływy", plannedIn - plannedOut < 0 ? "red" : "blue")}
      ${metric("Po terminie", String(overdue.length), overdue.length ? money(sum(overdue, "gross_cents")) : "Brak zaległości", overdue.length ? "red" : "green")}
    </section>
    <section class="cashflow-overview">
      <article class="panel cashflow-calendar"><div class="panel-head"><div><h2>Kalendarz płatności — ${escapeHtml(activeMonth ? monthLabel(activeMonth) : "brak miesiąca")}</h2><p>Kwoty brutto. Zielone pola oznaczają wpływy, czerwone — wypływy.</p></div></div>${renderCashflowCalendar(days)}</article>
      <article class="panel cashflow-summary"><div class="panel-head"><div><h2>Stan miesiąca</h2><p>Aktualizuj status po rzeczywistym zaksięgowaniu przelewu.</p></div></div><div class="cashflow-summary-body"><div><span>Pozycje do wykonania</span><strong>${actionable.length}</strong></div><div><span>Opłacone / rozliczone</span><strong>${paidThisMonth.length}</strong></div><div><span>Przepływ netto</span><strong class="${plannedIn - plannedOut < 0 ? "negative" : "positive"}">${money(plannedIn - plannedOut)}</strong></div></div></article>
    </section>
    <section class="panel cashflow-list"><div class="panel-head"><div><h2>Plan płatności</h2><p>Oznacz przelew jako opłacony, aby nie pojawiał się w kolejnej prognozie.</p></div></div>${actionable.length ? `<div class="table-wrap"><table><thead><tr><th>Termin</th><th>Kierunek</th><th>Dokument / kontrahent</th><th>Źródło</th><th>Status</th><th>Brutto</th><th></th></tr></thead><tbody>${actionable.map(cashflowRow).join("")}</tbody></table></div>` : emptyState("Brak niezapłaconych pozycji w wybranym miesiącu.")}</section>`;
}

function renderCashflowCalendar(days) {
  if (!days.length) return emptyState("Brak terminów płatności w tym miesiącu.");
  return `<div class="cashflow-days">${days.map((day) => {
    const hasIn = day.inflow > 0;
    const hasOut = day.outflow > 0;
    return `<article class="cashflow-day ${hasIn ? "has-in" : ""} ${hasOut ? "has-out" : ""}"><time>${escapeHtml(date(day.date))}</time><div class="cashflow-day-totals">${hasIn ? `<span class="cashflow-in">+${money(day.inflow)}</span>` : ""}${hasOut ? `<span class="cashflow-out">−${money(day.outflow)}</span>` : ""}</div><small>${day.items.length} ${day.items.length === 1 ? "płatność" : "płatności"}</small></article>`;
  }).join("")}</div>`;
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
  const invoiceRevenue = sum(state.invoices.filter((row) => row.invoice_type === "sales"), "net_amount_cents");
  const invoiceCosts = sum(state.invoices.filter((row) => row.invoice_type === "purchase"), "net_amount_cents");
  const revenue = invoiceRevenue;
  const actualCosts = invoiceCosts;
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
    <div class="page-heading"><div class="heading-copy"><p class="eyebrow">KARTA KONTRAKTU / ${escapeHtml(contract.trade || "KONTRAKT")}</p><h1>${escapeHtml(contract.name)}</h1><p>${escapeHtml(contract.client || "Brak klienta")}${contract.contract_number ? ` · ${escapeHtml(contract.contract_number)}` : ""}</p></div><div class="page-actions"><button class="button button-secondary" type="button" data-view="contracts">← Portfel</button>${editable ? `<button class="button button-secondary" type="button" data-action="edit-contract">Edytuj</button><button class="button button-secondary button-danger" type="button" data-action="delete-contract">Usuń</button>${button("+ Zadanie", "schedule")} ${button("+ Protokół", "settlement")} ${button("+ Zmiana", "change")} ${button("+ Dokument", "document")}` : ""}</div></div>
    <section class="metric-grid">
      ${metric("Wartość kontraktu", money(forecastValue), approvedChanges ? `Zmiany: ${money(approvedChanges)}` : "Wartość umowna netto", "yellow")}
      ${metric("Wpisane koszty", money(actualCosts), `${Math.round((actualCosts / Math.max(Number(contract.budget_cents), 1)) * 100)}% budżetu`, actualCosts > Number(contract.budget_cents) ? "red" : "blue")}
      ${metric("Faktury sprzedażowe", money(revenue), "Przychody z FV", "green")}
      ${metric("Marża prognozowana", money(forecastMargin), forecastMargin < 0 ? "Wymaga decyzji" : "Po kosztach wpisanych", forecastMargin < 0 ? "red" : "green")}
      ${metric("Pozostało do zafakturowania", money(remainingToInvoice), remainingToInvoice < 0 ? "Przekroczono wartość" : "Wg faktur sprzedażowych", remainingToInvoice < 0 ? "red" : "yellow")}
      ${metric("Kaucja pobrana", money(retentionCollected), retentionPercent ? `${percentLabel(retentionPercent)} z faktur sprzedażowych` : "Kaucja nieustawiona", retentionPercent ? "blue" : "yellow")}
    </section>
    <section class="contract-summary panel"><div><p class="eyebrow">STATUS REALIZACJI</p><h2>${statusTag(contract.status)}</h2><p>${escapeHtml(contract.description || "Brak dodatkowego opisu kontraktu.")}</p></div><div class="contract-progress"><strong>${contract.baseline_progress}%</strong><div class="progress"><span style="width:${clampProgress(contract.baseline_progress)}%"></span></div><small>Termin umowny: ${date(contract.due_date)}</small></div></section>
    ${renderContractBudget(contract, editable)}
    ${isOwner() ? `<section class="panel contract-history"><div class="panel-head"><div><h2>Historia kontraktu</h2><p>Audyt zmian metadanych kontraktu — dostępny wyłącznie dla właściciela.</p></div></div>${state.history.length ? `<div class="history-list">${state.history.map(historyRow).join("")}</div>` : emptyState("Brak zarejestrowanych zmian kontraktu.")}</section>` : ""}
    <section class="panel schedule-panel"><div class="panel-head"><div><h2>Harmonogram kontraktu</h2><p>${state.schedule.length ? `${scheduleDone} z ${state.schedule.length} zadań zakończonych${scheduleDelayed ? ` · ${scheduleDelayed} opóźnionych` : ""}` : "Zadania, terminy i odpowiedzialność za realizację."}</p></div>${editable ? button("+ Dodaj zadanie", "schedule") : ""}</div>${state.schedule.length ? `<div class="table-wrap"><table><thead><tr><th>Zadanie</th><th>Termin</th><th>Odpowiedzialny</th><th>Postęp</th><th>Status</th><th></th></tr></thead><tbody>${state.schedule.map(scheduleRow).join("")}</tbody></table></div>${renderGantt(state.schedule)}` : emptyState("Brak zadań w harmonogramie. Dodaj pierwszy etap realizacji.")}</section>
    <section class="detail-grid">
      <section class="panel"><div class="panel-head"><div><h2>Protokoły przerobowe</h2><p>Dokumentacja postępu robót — bez wpływu na podsumowania finansowe.</p></div></div>${state.settlements.length ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Protokół</th><th>Opis</th><th>Wartość informacyjna</th><th></th></tr></thead><tbody>${state.settlements.map(detailSettlementRow).join("")}</tbody></table></div>` : emptyState("Brak protokołów przerobowych.")}</section>
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
function invoiceAmountMetric(label, rows, tagText, tone) {
  const netCents = sum(rows, "net_amount_cents");
  const grossCents = rows.reduce((total, row) => total + grossAmountCents(row), 0);
  return `<article class="metric invoice-amount-metric"><div class="metric-label">${label}</div><div class="invoice-metric-amounts"><div><span>Netto</span><strong>${moneyExact(netCents)}</strong></div><div><span>Brutto</span><strong>${moneyExact(grossCents)}</strong></div></div><span class="tag tag-${tone}">${tagText}</span></article>`;
}
function emptyState(text) { return `<div class="empty">${text}</div>`; }
function costCategoryCard(category, rows) {
  const matching = rows.filter((row) => normalizeCostCategory(row.category) === category);
  const netCents = sum(matching, "net_amount_cents");
  const grossCents = matching.reduce((total, row) => total + grossAmountCents(row), 0);
  return `<article class="cost-category-card"><p>${escapeHtml(costCategoryLabel(category))}</p><div class="cost-category-amounts"><div><span>Netto</span><strong>${moneyExact(netCents)}</strong></div><div><span>Brutto</span><strong>${moneyExact(grossCents)}</strong></div></div><small>${matching.length} ${matching.length === 1 ? "pozycja" : "pozycje"}</small></article>`;
}

function renderContractBudget(contract, editable) {
  const categories = contractBudgetCategories();
  const plans = new Map((state.budgetCategories || []).map((row) => [row.category, row]));
  const purchaseInvoices = state.invoices.filter((row) => row.invoice_type === "purchase");
  const rows = categories.map((category) => {
    const plan = plans.get(category);
    const planned = Number(plan?.planned_cents || 0);
    const actual = sum(purchaseInvoices.filter((row) => normalizeContractBudgetCategory(row.contract_budget_category) === category), "net_amount_cents");
    const remaining = planned - actual;
    const usedPercent = planned ? Math.round((actual / planned) * 100) : 0;
    const action = editable ? `<button class="table-action" type="button" data-action="edit-budget-category" data-category="${category}">Ustaw plan</button>` : "";
    return `<tr><td><strong>${escapeHtml(contractBudgetCategoryLabel(category))}</strong>${plan?.notes ? `<small>${escapeHtml(plan.notes)}</small>` : ""}</td><td class="money">${planned ? money(planned) : "—"}</td><td class="money">${money(actual)}</td><td class="money ${remaining < 0 ? "money-negative" : ""}">${planned ? money(remaining) : "—"}</td><td><div class="budget-progress"><span style="width:${Math.min(100, Math.max(0, usedPercent))}%"></span></div><small>${planned ? `${usedPercent}% wykorzystania` : actual ? "Brak planu" : "—"}</small></td><td class="row-actions">${action}</td></tr>`;
  });
  const plannedTotal = sum([...plans.values()], "planned_cents");
  const actualTotal = sum(purchaseInvoices, "net_amount_cents");
  return `<section class="panel contract-budget-panel"><div class="panel-head"><div><h2>Budżet kontraktu według kategorii</h2><p>Plan kontra rzeczywiste koszty netto z FV zakupowych przypisanych do tego kontraktu.</p></div><div class="budget-panel-total"><span>Plan kategorii</span><strong>${plannedTotal ? money(plannedTotal) : "Nie ustawiono"}</strong></div></div><div class="table-wrap"><table><thead><tr><th>Kategoria</th><th>Plan netto</th><th>Wykonanie</th><th>Pozostało</th><th>Wykorzystanie</th><th></th></tr></thead><tbody>${rows.join("")}</tbody><tfoot><tr><th>Łącznie</th><th class="money">${plannedTotal ? money(plannedTotal) : money(contract.budget_cents)}</th><th class="money">${money(actualTotal)}</th><th class="money ${(plannedTotal ? plannedTotal : Number(contract.budget_cents || 0)) - actualTotal < 0 ? "money-negative" : ""}">${money((plannedTotal ? plannedTotal : Number(contract.budget_cents || 0)) - actualTotal)}</th><th colspan="2">${plannedTotal ? "Plan kategorii" : "Plan ogólny kontraktu"}</th></tr></tfoot></table></div><p class="panel-note">Koszt przypiszesz do kategorii podczas rozliczania FV zakupowej. Dla wcześniejszych dokumentów domyślną kategorią są „Pozostałe”.</p></section>`;
}

function contractBudgetCategories() {
  return ["materialy", "robocizna", "podwykonawcy", "sprzet", "pozostale"];
}

function contractBudgetCategoryLabel(value) {
  return ({ materialy: "Materiały", robocizna: "Robocizna", podwykonawcy: "Podwykonawcy", sprzet: "Sprzęt", pozostale: "Pozostałe" })[normalizeContractBudgetCategory(value)] || "Pozostałe";
}

function normalizeContractBudgetCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return contractBudgetCategories().includes(normalized) ? normalized : "pozostale";
}

function grossAmountCents(row) {
  const net = Number(row?.net_amount_cents || 0);
  const rate = Number(row?.vat_rate || 0);
  return Math.round(net * (1 + rate / 100));
}

function vatAmountCents(row) {
  return grossAmountCents(row) - Number(row?.net_amount_cents || 0);
}

function cashflowItems(invoices, costs) {
  const invoiceItems = (invoices || []).map((row) => ({
    id: row.id,
    source: "invoice",
    direction: row.invoice_type === "sales" ? "in" : "out",
    document_number: row.document_number,
    counterparty: row.counterparty,
    cash_date: row.due_date || row.issue_date,
    paid_at: row.paid_at,
    is_paid: ["oplacona", "zaksiegowana"].includes(row.payment_status),
    payment_status: row.payment_status,
    gross_cents: grossAmountCents(row),
    source_label: row.invoice_type === "sales" ? "FV sprzedażowa" : "FV zakupowa",
  }));
  const costItems = (costs || []).map((row) => ({
    id: row.id,
    source: "cost",
    direction: "out",
    document_number: row.document_number || row.description || "Koszt firmowy",
    counterparty: row.vendor,
    cash_date: row.due_date || row.cost_date,
    paid_at: row.paid_at,
    is_paid: ["oplacona", "zaksiegowana"].includes(row.payment_status),
    payment_status: row.payment_status,
    gross_cents: grossAmountCents(row),
    source_label: "Koszt firmowy",
  }));
  return [...invoiceItems, ...costItems].filter((row) => row.cash_date);
}

function cashflowMonthDays(month, rows) {
  const grouped = new Map();
  for (const row of rows) {
    const day = grouped.get(row.cash_date) || { date: row.cash_date, items: [], inflow: 0, outflow: 0 };
    day.items.push(row);
    if (row.direction === "in") day.inflow += Number(row.gross_cents || 0);
    else day.outflow += Number(row.gross_cents || 0);
    grouped.set(row.cash_date, day);
  }
  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function cashflowRow(row) {
  const isOverdue = row.cash_date < todayKey();
  const controls = canManageFinance() ? `<button class="table-action ${row.direction === "out" ? "danger" : ""}" type="button" data-action="mark-payment-paid" data-payment-source="${row.source}" data-id="${row.id}">Oznacz jako opłaconą</button>` : "";
  return `<tr><td>${date(row.cash_date)}${isOverdue ? `<small class="overdue">Po terminie</small>` : ""}</td><td><span class="cashflow-direction ${row.direction === "in" ? "cashflow-in" : "cashflow-out"}">${row.direction === "in" ? "Wpływ" : "Wypływ"}</span></td><td><strong>${escapeHtml(row.document_number || "—")}</strong><small>${escapeHtml(row.counterparty || "—")}</small></td><td>${escapeHtml(row.source_label)}</td><td>${statusTag(row.payment_status)}</td><td class="money ${row.direction === "out" ? "money-negative" : ""}">${row.direction === "in" ? "+" : "−"}${money(row.gross_cents)}</td><td class="row-actions">${controls}</td></tr>`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function monthNavigator(kind, activeMonth, _groups, noun) {
  const selected = activeMonth || currentMonthKey();
  const lastAvailable = kind === "cashflow" ? shiftMonth(currentMonthKey(), 12) : currentMonthKey();
  const hasNewerMonth = selected < lastAvailable;
  return `<section class="month-navigator" aria-label="Nawigacja miesięczna ${escapeHtml(noun)}"><button class="month-button" type="button" data-action="${kind}-month-previous" aria-label="Poprzedni miesiąc">←</button><div><p>WYBRANY MIESIĄC</p><input class="month-picker" type="month" data-month-picker="${kind}" value="${selected}" max="${lastAvailable}" aria-label="Wybierz miesiąc" /><small>${escapeHtml(noun)} w wybranym okresie</small></div><button class="month-button" type="button" data-action="${kind}-month-next" ${hasNewerMonth ? "" : "disabled"} aria-label="Następny miesiąc">→</button></section>`;
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
  return `<tr><td>${date(row.settlement_date)}<small>okres: ${date(row.period)}</small></td><td><strong>${escapeHtml(relationName(row.contracts))}</strong></td><td>Protokół przerobowy</td><td>${escapeHtml(row.reference_number || row.budget_category || "—")}</td><td class="money">${money(row.net_amount_cents)}</td></tr>`;
}
function invoiceRow(row) {
  const assignment = invoiceAssignmentSummary(row);
  const attachments = invoiceAttachmentCount(row.id);
  const preview = row.source === "ksef" && row.ksef_number && canManageFinance()
    ? `<button class="table-action" type="button" data-action="preview-ksef-invoice" data-id="${row.id}">Podgląd</button>`
    : "";
  const attachmentControl = row.source !== "ksef"
    ? `<button class="table-action" type="button" data-action="invoice-attachments" data-id="${row.id}">Skan / OCR${attachments ? ` (${attachments})` : ""}</button>`
    : "";
  const remove = isOwner() ? `<button class="table-action danger" type="button" data-action="delete-invoice" data-id="${row.id}">Usuń</button>` : "";
  const allocate = invoiceIsCorrection(row) ? "" : `<button class="table-action" type="button" data-action="allocate-invoice" data-id="${row.id}">Rozlicz</button>`;
  const controls = canManageFinance() ? `${preview}${attachmentControl}${allocate}<button class="table-action" type="button" data-action="edit-invoice" data-id="${row.id}">Edytuj</button>${remove}` : "";
  return `<tr><td data-label="Faktura"><strong>${escapeHtml(row.document_number)}</strong><small>${escapeHtml(invoiceSourceLabel(row))}</small></td><td class="invoice-counterparty-cell" data-label="Kontrahent"><span class="invoice-counterparty" data-tooltip="${escapeHtml(row.counterparty || "Brak kontrahenta")}"><span class="invoice-counterparty-text">${escapeHtml(row.counterparty || "—")}</span></span></td><td data-label="Data wystawienia">${date(row.issue_date)}</td><td data-label="Termin płatności">${date(row.due_date)}</td><td data-label="Typ">${row.invoice_type === "sales" ? "Sprzedażowa" : "Zakupowa"}</td><td data-label="Przypisanie">${escapeHtml(assignment || "—")}</td><td data-label="Netto" class="money">${money(row.net_amount_cents)}</td><td data-label="Kwota VAT" class="money">${money(vatAmountCents(row))}</td><td data-label="Brutto" class="money">${money(grossAmountCents(row))}</td><td data-label="Status">${statusTag(row.payment_status)}</td><td data-label="Akcje" class="row-actions">${controls}</td></tr>`;
}
function renderKsefPreview(activeMonth) {
  if (state.ksefPreviewMonth !== activeMonth) return "";
  const rows = state.ksefPreview;
  const imported = new Set(state.invoices
    .filter((row) => row.ksef_environment === state.ksefEnvironment)
    .map((row) => row.ksef_number)
    .filter(Boolean));
  const selectableRows = rows.filter((row) => !imported.has(row.ksefNumber));
  const selectedCount = selectableRows.filter((row) => state.ksefSelectedNumbers.has(row.ksefNumber)).length;
  const actions = rows.length ? `<div class="row-actions"><button class="button button-secondary" type="button" data-action="select-all-ksef-preview" ${selectableRows.length ? "" : "disabled"}>Zaznacz dostępne</button><button class="button button-primary" type="button" data-action="import-ksef-preview" ${selectedCount ? "" : "disabled"}>Importuj zaznaczone (${selectedCount})</button></div>` : "";
  return `<section class="panel ksef-preview"><div class="panel-head"><div><h2>Podgląd ${escapeHtml(ksefEnvironmentLabel())} — ${escapeHtml(monthLabel(activeMonth))}</h2><p>Wybierz pozycje do zapisu. Import ponownie odczyta ich dane z KSeF i zapisze je jako nieprzypisane faktury w PrądPlan.</p></div>${actions}</div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Import</th><th>Typ</th><th>Numer dokumentu</th><th>Numer KSeF</th><th>Kontrahent</th><th>Data</th><th>Netto</th><th>VAT</th><th>Brutto</th></tr></thead><tbody>${rows.map((row) => ksefPreviewRow(row, imported.has(row.ksefNumber))).join("")}</tbody></table></div>` : emptyState(`${ksefEnvironmentLabel()} nie zwrócił faktur z wybranego miesiąca.`)}${state.ksefPreviewLimited ? `<p class="panel-note">Pokazano maksymalnie 100 faktur sprzedażowych i 100 zakupowych. Zawęź okres przed importem większej liczby dokumentów.</p>` : ""}</section>`;
}
function ksefPreviewRow(row, alreadyImported) {
  const checkbox = alreadyImported
    ? `<span class="tag tag-green">W rejestrze</span>`
    : `<input type="checkbox" data-ksef-select="${escapeHtml(row.ksefNumber)}" ${state.ksefSelectedNumbers.has(row.ksefNumber) ? "checked" : ""} aria-label="Wybierz fakturę ${escapeHtml(row.documentNumber || row.ksefNumber)} do importu" />`;
  return `<tr><td>${checkbox}</td><td>${row.type === "sales" ? "Sprzedażowa" : "Zakupowa"}</td><td><strong>${escapeHtml(row.documentNumber || "—")}</strong></td><td><small>${escapeHtml(row.ksefNumber || "—")}</small></td><td>${escapeHtml(row.counterparty || "—")}</td><td>${date(row.issueDate)}</td><td class="money">${moneyKsef(row.netAmount, row.currency)}</td><td class="money">${moneyKsef(row.vatAmount, row.currency)}</td><td class="money">${moneyKsef(row.grossAmount, row.currency)}</td></tr>`;
}
function companyCostRow(row) {
  if (row.entry_type === "invoice_cost") return invoiceCostRow(row);
  return costRow(row);
}

function costRow(row) {
  const controls = canManageFinance() ? `<button class="table-action" type="button" data-action="edit-cost" data-id="${row.id}">Edytuj</button><button class="table-action danger" type="button" data-action="delete-cost" data-id="${row.id}">Usuń</button>` : "";
  return `<tr><td data-label="Data">${date(row.cost_date)}</td><td data-label="Kategoria">${escapeHtml(costCategoryLabel(row.category))}</td><td data-label="Opis"><strong>${escapeHtml(row.description || "—")}</strong></td><td data-label="Dostawca">${escapeHtml(row.vendor || "—")}</td><td data-label="Dokument">${escapeHtml(row.document_number || "—")}</td><td data-label="Źródło"><span class="tag tag-blue">Ręczny koszt</span></td><td data-label="Netto" class="money">${money(row.net_amount_cents)}</td><td data-label="Kwota VAT" class="money">${money(vatAmountCents(row))}</td><td data-label="Brutto" class="money">${money(grossAmountCents(row))}</td><td data-label="Status">${statusTag(row.payment_status)}</td><td data-label="Akcje" class="row-actions">${controls}</td></tr>`;
}

function invoiceCostRow(row) {
  const invoice = row.invoice;
  const preview = invoice.source === "ksef" && invoice.ksef_number && canManageFinance()
    ? `<button class="table-action" type="button" data-action="preview-ksef-invoice" data-id="${invoice.id}">Podgląd</button>`
    : "";
  const controls = canManageFinance()
    ? `${preview}<button class="table-action" type="button" data-action="allocate-invoice" data-id="${invoice.id}">Rozlicz</button>`
    : "";
  const source = invoice.source === "ksef" ? invoiceSourceLabel(invoice) : "FV ręczna";
  return `<tr><td data-label="Data">${date(row.cost_date)}</td><td data-label="Kategoria">${escapeHtml(costCategoryLabel(row.category))}</td><td data-label="Opis"><strong>${escapeHtml(row.description)}</strong><small>${row.net_amount_cents !== invoice.net_amount_cents ? `Część FV: ${money(row.net_amount_cents)}` : "Cała kwota FV"}</small></td><td data-label="Dostawca">${escapeHtml(row.vendor || "—")}</td><td data-label="Dokument"><strong>${escapeHtml(row.document_number || "—")}</strong></td><td data-label="Źródło"><span class="tag tag-yellow">${escapeHtml(source)}</span></td><td data-label="Netto" class="money">${money(row.net_amount_cents)}</td><td data-label="Kwota VAT" class="money">${money(vatAmountCents(row))}</td><td data-label="Brutto" class="money">${money(grossAmountCents(row))}</td><td data-label="Status">${statusTag(row.payment_status)}</td><td data-label="Akcje" class="row-actions">${controls}</td></tr>`;
}
function detailSettlementRow(row) {
  const controls = canManageContracts() ? `<button class="table-action" type="button" data-action="edit-settlement" data-id="${row.id}">Edytuj</button><button class="table-action danger" type="button" data-action="delete-settlement" data-id="${row.id}">Usuń</button>` : "";
  return `<tr><td>${date(row.settlement_date)}</td><td>Protokół przerobowy</td><td>${escapeHtml(row.reference_number || row.budget_category || "—")}</td><td class="money">${money(row.net_amount_cents)}</td><td class="row-actions">${controls}</td></tr>`;
}
function detailInvoiceRow(row) {
  const preview = row.source === "ksef" && row.ksef_number && canManageFinance()
    ? `<button class="table-action" type="button" data-action="preview-ksef-invoice" data-id="${row.id}">Podgląd</button>`
    : "";
  const remove = isOwner() ? `<button class="table-action danger" type="button" data-action="delete-invoice" data-id="${row.id}">Usuń</button>` : "";
  const attachments = invoiceAttachmentCount(row.id);
  const attachmentControl = row.source !== "ksef"
    ? `<button class="table-action" type="button" data-action="invoice-attachments" data-id="${row.id}">Skan / OCR${attachments ? ` (${attachments})` : ""}</button>`
    : "";
  const controls = canManageFinance() ? `${preview}${attachmentControl}<button class="table-action" type="button" data-action="allocate-invoice" data-id="${row.id}">Rozlicz</button><button class="table-action" type="button" data-action="edit-invoice" data-id="${row.id}">Edytuj</button>${remove}` : "";
  const retention = row.invoice_type === "sales" ? retentionAmount(row.net_amount_cents, state.contractDetail?.retention_percent) : 0;
  return `<tr><td><strong>${escapeHtml(row.document_number)}</strong><small>${date(row.issue_date)}${row.allocation_portion ? " · część FV" : ""}</small></td><td>${escapeHtml(row.counterparty)}</td><td>${row.invoice_type === "sales" ? "Sprzedażowa" : "Zakupowa"}</td><td class="money">${money(row.net_amount_cents)}</td><td class="money">${row.invoice_type === "sales" ? money(retention) : "—"}</td><td>${statusTag(row.payment_status)}</td><td class="row-actions">${controls}</td></tr>`;
}
function invoiceAttachmentCount(invoiceId) {
  return (state.invoiceAttachments || []).filter((row) => row.invoice_id === invoiceId).length;
}
function invoiceRuleRow(row) {
  const match = [row.match_nip ? `NIP: ${row.match_nip}` : "", row.match_text ? `Tekst: ${row.match_text}` : ""].filter(Boolean).join(" · ");
  const target = row.target_type === "contract" ? relationName(row.contracts) : costCategoryLabel(row.company_category);
  return `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(match || "—")}</td><td>${row.invoice_type === "sales" ? "Sprzedażowa" : row.invoice_type === "purchase" ? "Zakupowa" : "Dowolna"}</td><td>${escapeHtml(target || "—")}</td><td>${Number(row.priority || 0)}</td><td>${row.active ? `<span class="tag tag-green">Aktywna</span>` : `<span class="tag">Wyłączona</span>`}</td><td class="row-actions"><button class="table-action" type="button" data-action="edit-invoice-rule" data-id="${row.id}">Edytuj</button><button class="table-action danger" type="button" data-action="delete-invoice-rule" data-id="${row.id}">Usuń</button></td></tr>`;
}

function invoiceAllocationsFor(invoiceId) {
  return (state.invoiceAllocations || []).filter((row) => row.invoice_id === invoiceId);
}

function invoiceUsesSplit(row) {
  return invoiceAllocationsFor(row.id).length > 0;
}

function invoiceAllocatedAmount(row) {
  const allocations = invoiceAllocationsFor(row.id);
  if (allocations.length) return sum(allocations, "net_amount_cents");
  return row.allocation === "unassigned" ? 0 : Number(row.net_amount_cents || 0);
}

function invoiceUnallocatedAmount(row) {
  return Math.max(0, Number(row.net_amount_cents || 0) - invoiceAllocatedAmount(row));
}

function invoiceNeedsResolution(row) {
  return invoiceUnallocatedAmount(row) > 0;
}

function invoiceIsCorrection(row) {
  return Number(row?.net_amount_cents || 0) < 0;
}

function allocationTargetLabel(row) {
  if (row.target_type === "contract") {
    return state.contracts.find((contract) => contract.id === row.contract_id)?.name || "Kontrakt usunięty";
  }
  return costCategoryLabel(row.company_category);
}

function invoiceAssignmentSummary(row) {
  const allocations = invoiceAllocationsFor(row.id);
  if (allocations.length) {
    const labels = [...new Set(allocations.map(allocationTargetLabel))];
    const suffix = invoiceNeedsResolution(row) ? ` · pozostało ${money(invoiceUnallocatedAmount(row))}` : "";
    return `${labels.join(" + ")}${suffix}`;
  }
  if (row.allocation === "contract") {
    const relatedName = relationName(row.contracts);
    return (relatedName && relatedName !== "—" ? relatedName : state.contracts.find((contract) => contract.id === row.contract_id)?.name) || "Kontrakt";
  }
  if (row.allocation === "company") return costCategoryLabel(row.company_category);
  return "Nieprzypisana";
}

function invoicePortionsForContract(contractId, invoices, allocations) {
  const allocationByInvoice = new Map();
  for (const allocation of allocations || []) {
    const list = allocationByInvoice.get(allocation.invoice_id) || [];
    list.push(allocation);
    allocationByInvoice.set(allocation.invoice_id, list);
  }
  const portions = [];
  for (const invoice of invoices || []) {
    const splits = allocationByInvoice.get(invoice.id) || [];
    if (splits.length) {
      for (const allocation of splits) {
        if (allocation.target_type !== "contract" || allocation.contract_id !== contractId) continue;
        portions.push({ ...invoice, net_amount_cents: allocation.net_amount_cents, contract_budget_category: allocation.budget_category || invoice.contract_budget_category || "pozostale", allocation_portion: true, allocation_id: allocation.id });
      }
      continue;
    }
    if (invoice.allocation === "contract" && invoice.contract_id === contractId) {
      portions.push({ ...invoice, allocation_portion: false });
    }
  }
  return portions.sort((left, right) => String(right.issue_date || "").localeCompare(String(left.issue_date || "")));
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
  if (["contract", "settlement", "change", "document", "schedule", "budget-category"].includes(mode) && !canManageContracts()) return;
  if (["invoice", "cost", "invoice-rule", "invoice-attachment"].includes(mode) && !canManageFinance()) return;
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
  const invoiceAllocationOptions = record.invoice_type === "sales"
    ? [["unassigned", "Do przypisania"], ["contract", "Kontrakt"]]
    : [["unassigned", "Do przypisania"], ["contract", "Kontrakt"], ["company", "Koszt firmowy"]];

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
    eyebrow: record.id ? "EDYCJA PROTOKOŁU" : "PROTOKÓŁ PRZEROBOWY", title: record.id ? "Edytuj protokół" : "Dodaj protokół", fields: [
      field("Kontrakt", select("contract_id", contractSelect, "required"), "full"),
      field("Okres", input("period", "date", record.period || firstDay, "required")),
      field("Data protokołu", input("settlement_date", "date", record.settlement_date || today, "required")),
      field("Wartość protokołu netto (zł; tylko informacyjnie)", moneyInput("net_amount", record.id ? moneyValue(record.net_amount_cents) : "")),
      field("VAT (%)", input("vat_rate", "number", record.vat_rate ?? 23, "min=\"0\" max=\"100\" step=\"0.01\" required")),
      field("Numer / opis protokołu", input("reference_number", "text", record.reference_number)),
      field("Zakres / etap robót", input("budget_category", "text", record.budget_category || "pozostałe")),
    ].join("")
  };
  if (mode === "invoice") return {
    eyebrow: record.id ? "EDYCJA FAKTURY" : "REJESTR FAKTUR", title: record.id ? "Edytuj fakturę" : "Dodaj fakturę", fields: [
      field("Typ faktury", select("invoice_type", options([["purchase", "Zakupowa"], ["sales", "Sprzedażowa"]], record.invoice_type || "purchase"))),
      field("Źródło", `<input name="source" type="hidden" value="${record.source === "ksef" ? "ksef" : "manual"}" /><span class="readonly-field">${record.source === "ksef" ? escapeHtml(invoiceSourceLabel(record)) : "Ręczna"}</span>`),
      field("Numer dokumentu", input("document_number", "text", record.document_number, "required")),
      field("Kontrahent", input("counterparty", "text", record.counterparty, "required")),
      field("NIP kontrahenta", input("counterparty_nip", "text", record.counterparty_nip, "inputmode=\"numeric\" placeholder=\"np. 5423261207\"")),
      field("Data wystawienia", input("issue_date", "date", record.issue_date || today, "required")),
      field("Termin płatności", input("due_date", "date", record.due_date)),
      field("Kwota netto (zł)", moneyInput("net_amount", record.id ? moneyValue(record.net_amount_cents) : "")),
      field("VAT (%)", input("vat_rate", "number", record.vat_rate ?? 23, "min=\"0\" max=\"100\" step=\"0.01\" required")),
      field(record.invoice_type === "sales" ? "Przypisanie (FV sprzedażowa → kontrakt)" : "Przypisanie", select("allocation", options(invoiceAllocationOptions, record.allocation || (state.activeView === "contractDetail" ? "contract" : "unassigned")))),
      field("Kontrakt (gdy przypisanie: kontrakt)", select("contract_id", contractSelect)),
      field("Kategoria budżetu (gdy kontrakt)", select("contract_budget_category", options([["materialy", "Materiały"], ["robocizna", "Robocizna"], ["podwykonawcy", "Podwykonawcy"], ["sprzet", "Sprzęt"], ["pozostale", "Pozostałe"]], normalizeContractBudgetCategory(record.contract_budget_category || "pozostale")))),
      field("Kategoria firmowa (gdy koszt firmowy)", select("company_category", options([[
        "", "Wybierz kategorię"
      ], ["paliwo", "Paliwo"], ["narzedzia", "Narzędzia"], ["ubior_bhp", "Ubiór BHP"], ["najem_lokali", "Najem lokali"], ["pozostale", "Pozostałe"]], normalizeCostCategory(record.company_category || "")))),
      field("Status płatności", select("payment_status", statusOptions(record.payment_status || "do_platnosci"))),
      field("Data opłacenia / zaksięgowania", input("paid_at", "date", record.paid_at)),
      !record.id ? field("Skan FV / paragonu z NIP do OCR (opcjonalnie)", `<input name="scan_file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" /><small class="field-hint">Dla dokumentu ręcznego. Skan zostanie zapisany prywatnie i oznaczony jako oczekujący na OCR.</small>`, "full") : "",
    ].join("")
  };
  if (mode === "invoice-rule") return {
    eyebrow: record.id ? "EDYCJA REGUŁY KSEF" : "REGUŁA AUTOMATYCZNEGO PRZYPISANIA", title: record.id ? "Edytuj regułę" : "Dodaj regułę", fields: [
      field("Nazwa reguły", input("name", "text", record.name, "required"), "full"),
      field("Typ faktury", select("invoice_type", options([["", "Dowolna"], ["purchase", "Zakupowa"], ["sales", "Sprzedażowa"]], record.invoice_type || ""))),
      field("Priorytet (niższy = wcześniej)", input("priority", "number", record.id ? record.priority : 100, "min=\"0\" max=\"9999\" required")),
      field("NIP kontrahenta (opcjonalnie)", input("match_nip", "text", record.match_nip, "inputmode=\"numeric\" placeholder=\"np. 5423261207\"")),
      field("Szukany tekst (opcjonalnie)", input("match_text", "text", record.match_text, "placeholder=\"np. rolki, ABC-123\"")),
      field("Cel przypisania", select("target_type", options([["contract", "Kontrakt"], ["company", "Koszt firmowy"]], record.target_type || "contract"))),
      field("Kontrakt (gdy cel: kontrakt)", select("contract_id", contractSelect)),
      field("Kategoria firmowa (gdy cel: koszt firmowy)", select("company_category", options([["", "Wybierz kategorię"], ["paliwo", "Paliwo"], ["narzedzia", "Narzędzia"], ["ubior_bhp", "Ubiór BHP"], ["najem_lokali", "Najem lokali"], ["pozostale", "Pozostałe"]], normalizeCostCategory(record.company_category || "")))),
      `<label class="check-field full"><input name="active" type="checkbox" ${record.id ? (record.active ? "checked" : "") : "checked"} />Reguła aktywna podczas kolejnych importów KSeF</label>`,
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
      field("Termin płatności", input("due_date", "date", record.due_date)),
      field("Status płatności", select("payment_status", statusOptions(record.payment_status || "do_platnosci"))),
      field("Data opłacenia / zaksięgowania", input("paid_at", "date", record.paid_at)),
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
  if (mode === "invoice-attachment") return { eyebrow: "ZAŁĄCZNIK DO FAKTURY", title: "Dodaj załącznik", fields: [
      field("Nazwa pomocnicza (opcjonalnie)", input("label", "text", "", "placeholder=\"np. skan podpisanej FV\""), "full"),
      field("Plik (PDF, JPG, PNG, WEBP; maks. 15 MB)", `<input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required />`, "full"),
    ].join("") };
  if (mode === "budget-category") return { eyebrow: "BUDŻET KONTRAKTU", title: `Plan: ${contractBudgetCategoryLabel(record.category)}`, fields: [
      field("Kategoria", select("category", options(contractBudgetCategories().map((category) => [category, contractBudgetCategoryLabel(category)]), normalizeContractBudgetCategory(record.category))), "required"),
      field("Plan kosztów netto (zł)", moneyInput("planned_amount", record.id ? moneyValue(record.planned_cents) : "")),
      field("Notatka (opcjonalnie)", `<textarea name="notes" placeholder="Założenia kosztowe, limit lub ustalenie…">${escapeHtml(record.notes || "")}</textarea>`, "full"),
    ].join("") };
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
  let postSaveNotice = "";
  formError.hidden = true;
  try {
    submit.disabled = true;
    submit.textContent = "Zapisywanie…";
    if (mode === "document") await saveDocument(form);
    else if (mode === "invoice-attachment") await saveInvoiceAttachment(form);
    else if (mode === "invite") await createUser(form);
    else if (mode === "manage-user") await updateUser(form, record);
    else {
      const { table, payload } = formPayload(mode, form);
      if (mode === "invoice" && !record?.id) {
        const { data: savedInvoice, error } = await supabase
          .from("invoices")
          .insert({ ...payload, created_by: state.user.id })
          .select("id, source")
          .single();
        if (error) throw error;
        const scan = form.get("scan_file");
        if (savedInvoice.source === "manual" && scan instanceof File && scan.size) {
          try {
            await uploadInvoiceAttachmentFile(savedInvoice.id, scan, "Skan do OCR", "queued");
            postSaveNotice = "Faktura i skan zostały zapisane. Skan przekazano do kolejki OCR.";
          } catch (uploadError) {
            postSaveNotice = `Faktura została zapisana, ale nie udało się dodać skanu: ${uploadError.message || "nieznany błąd"}`;
          }
        }
      } else {
        const query = record?.id
          ? supabase.from(table).update(payload).eq("id", record.id)
          : supabase.from(table).insert({ ...payload, created_by: state.user.id });
        const { error } = await query;
        if (error) throw error;
      }
    }
    modal.close();
    state.modalRecord = null;
    await loadView(supabase);
    if (postSaveNotice) window.alert(postSaveNotice);
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
document.querySelector("#invoice-preview-close").addEventListener("click", () => invoicePreviewModal?.close());
document.querySelector("#invoice-preview-dismiss").addEventListener("click", () => invoicePreviewModal?.close());
document.querySelector("#invoice-attachments-close")?.addEventListener("click", () => invoiceAttachmentsModal?.close());
invoiceAttachmentsContent?.addEventListener("click", async (event) => {
  const element = event.target.closest("[data-invoice-attachment-action]");
  if (!element) return;
  try {
    const action = element.dataset.invoiceAttachmentAction;
    const id = element.dataset.id;
    if (action === "upload") {
      invoiceAttachmentsModal?.close();
      openEntryModal("invoice-attachment");
    }
    if (action === "download") await downloadInvoiceAttachment(id);
    if (action === "queue-ocr") await updateInvoiceAttachmentOcr(id);
    if (action === "delete") await deleteInvoiceAttachment(id);
  } catch (error) {
    window.alert(error.message || "Nie udało się wykonać operacji na załączniku.");
  }
});
document.querySelector("#invoice-preview-download").addEventListener("click", () => {
  try {
    downloadKsefInvoicePdf();
  } catch (error) {
    window.alert(error.message || "Nie udało się przygotować pliku PDF.");
  }
});
document.querySelector("#invoice-delete-close").addEventListener("click", () => invoiceDeleteModal?.close());
document.querySelector("#invoice-delete-cancel").addEventListener("click", () => invoiceDeleteModal?.close());
invoiceDeleteForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = invoiceDeleteForm.querySelector("button[type=submit]");
  const password = String(new FormData(invoiceDeleteForm).get("password") || "");
  invoiceDeleteError.hidden = true;
  try {
    submit.disabled = true;
    submit.textContent = "Usuwanie…";
    await deleteInvoiceWithPassword(password);
    invoiceDeleteModal.close();
    invoiceDeleteForm.reset();
    state.pendingInvoiceDeleteId = null;
    await loadView(state.supabase);
  } catch (error) {
    invoiceDeleteError.textContent = error.message || "Nie udało się usunąć faktury.";
    invoiceDeleteError.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = "Usuń fakturę";
  }
});

document.querySelector("#invoice-allocation-close").addEventListener("click", () => invoiceAllocationModal?.close());
document.querySelector("#invoice-allocation-cancel").addEventListener("click", () => invoiceAllocationModal?.close());
document.querySelector("#invoice-allocation-add").addEventListener("click", () => {
  if (!state.pendingInvoiceAllocationId) return;
  renderInvoiceAllocationRows([...readInvoiceAllocationRows(), defaultInvoiceAllocationRow()]);
});
invoiceAllocationRows?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-allocation-remove]");
  if (!button) return;
  const rows = readInvoiceAllocationRows();
  rows.splice(Number(button.dataset.allocationRemove), 1);
  renderInvoiceAllocationRows(rows);
});
invoiceAllocationRows?.addEventListener("input", updateInvoiceAllocationTotal);
invoiceAllocationRows?.addEventListener("change", (event) => {
  const changed = event.target;
  if (!(changed instanceof HTMLSelectElement) || changed.name !== "target_type") {
    updateInvoiceAllocationTotal();
    return;
  }
  const rowElement = changed.closest("[data-allocation-row]");
  const index = [...invoiceAllocationRows.querySelectorAll("[data-allocation-row]")].indexOf(rowElement);
  const rows = readInvoiceAllocationRows();
  if (index < 0 || !rows[index]) return;
  rows[index].targetType = changed.value === "company" ? "company" : "contract";
  if (rows[index].targetType === "contract") rows[index].category = "";
  else rows[index].contractId = "";
  renderInvoiceAllocationRows(rows);
});
invoiceAllocationForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = invoiceAllocationForm.querySelector("button[type=submit]");
  if (invoiceAllocationError) invoiceAllocationError.hidden = true;
  try {
    submit.disabled = true;
    submit.textContent = "Zapisywanie…";
    await saveInvoiceAllocations();
    invoiceAllocationModal.close();
    state.pendingInvoiceAllocationId = null;
    await loadView(state.supabase);
  } catch (error) {
    if (invoiceAllocationError) {
      invoiceAllocationError.textContent = error.message || "Nie udało się zapisać rozliczenia faktury.";
      invoiceAllocationError.hidden = false;
    }
  } finally {
    submit.disabled = false;
    submit.textContent = "Zapisz rozliczenie";
  }
});

function openInvoiceAllocationModal(invoiceId) {
  if (!canManageFinance()) throw new Error("Brak uprawnień do rozliczania faktur.");
  const invoice = state.invoices.find((row) => row.id === invoiceId);
  if (!invoice) throw new Error("Nie znaleziono faktury do rozliczenia.");
  if (!invoiceAllocationModal || !invoiceAllocationRows || !invoiceAllocationSummary) throw new Error("Nie można otworzyć formularza rozliczenia.");

  state.pendingInvoiceAllocationId = invoiceId;
  if (invoiceAllocationError) invoiceAllocationError.hidden = true;
  if (invoiceAllocationTitle) invoiceAllocationTitle.textContent = `Rozlicz: ${invoice.document_number}`;
  const salesInvoice = invoice.invoice_type === "sales";
  const allocationHint = salesInvoice
    ? "FV sprzedażową można przypisać wyłącznie do kontraktu."
    : "Podziel kwotę pomiędzy kontrakty lub kategorię kosztu firmowego.";
  invoiceAllocationSummary.innerHTML = `<div class="allocation-summary"><strong>${escapeHtml(invoice.counterparty || "Brak kontrahenta")} · ${escapeHtml(invoice.document_number)}</strong><span>Wartość netto faktury: <strong>${money(invoice.net_amount_cents)}</strong>. ${allocationHint}</span></div>`;

  const existingAllocations = invoiceAllocationsFor(invoiceId);
  const initialRows = existingAllocations.length
    ? existingAllocations.map((row) => ({ targetType: salesInvoice ? "contract" : row.target_type, contractId: row.contract_id || "", category: salesInvoice ? "" : row.company_category || "", budgetCategory: row.budget_category || "pozostale", amountCents: Number(row.net_amount_cents || 0) }))
    : [{
      targetType: salesInvoice ? "contract" : invoice.allocation === "company" ? "company" : "contract",
      contractId: invoice.allocation === "contract" ? invoice.contract_id || "" : state.contractDetail?.id || "",
      category: !salesInvoice && invoice.allocation === "company" ? invoice.company_category || "pozostale" : "",
      budgetCategory: invoice.allocation === "contract" ? invoice.contract_budget_category || "pozostale" : "pozostale",
      amountCents: Number(invoice.net_amount_cents || 0),
    }];
  renderInvoiceAllocationRows(initialRows);
  invoiceAllocationModal.showModal();
}

function defaultInvoiceAllocationRow() {
  return { targetType: "contract", contractId: state.contractDetail?.id || "", category: "", budgetCategory: "pozostale", amountCents: 0 };
}

function invoiceAllocationContractOptions(selected = "") {
  const contracts = [...state.contracts];
  if (state.contractDetail?.id && !contracts.some((row) => row.id === state.contractDetail.id)) contracts.push(state.contractDetail);
  return [["", "Wybierz kontrakt"], ...contracts.map((row) => [row.id, row.name])]
    .map(([value, label]) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected || "") ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function invoiceAllocationCategoryOptions(selected = "") {
  return [["", "Wybierz kategorię"], ["paliwo", "Paliwo"], ["narzedzia", "Narzędzia"], ["ubior_bhp", "Ubiór BHP"], ["najem_lokali", "Najem lokali"], ["pozostale", "Pozostałe"]]
    .map(([value, label]) => `<option value="${value}" ${value === normalizeCostCategory(selected || "") ? "selected" : ""}>${label}</option>`).join("");
}

function invoiceAllocationBudgetCategoryOptions(selected = "pozostale") {
  return contractBudgetCategories()
    .map((category) => `<option value="${category}" ${category === normalizeContractBudgetCategory(selected) ? "selected" : ""}>${escapeHtml(contractBudgetCategoryLabel(category))}</option>`).join("");
}

function renderInvoiceAllocationRows(rows) {
  if (!invoiceAllocationRows) return;
  const invoice = state.invoices.find((row) => row.id === state.pendingInvoiceAllocationId);
  const salesInvoice = invoice?.invoice_type === "sales";
  invoiceAllocationRows.innerHTML = rows.map((row, index) => {
    const targetType = salesInvoice ? "contract" : row.targetType;
    const targetField = salesInvoice
      ? `<label>Cel<input name="target_type" type="hidden" value="contract" /><span class="readonly-field">Kontrakt</span></label>`
      : `<label>Cel<select name="target_type"><option value="contract" ${targetType === "contract" ? "selected" : ""}>Kontrakt</option><option value="company" ${targetType === "company" ? "selected" : ""}>Koszt firmowy</option></select></label>`;
    const budgetField = salesInvoice
      ? `<input name="budget_category" type="hidden" value="pozostale" />`
      : `<label class="${targetType !== "contract" ? "is-disabled" : ""}">Budżet kontraktu<select name="budget_category" ${targetType !== "contract" ? "disabled" : ""}>${invoiceAllocationBudgetCategoryOptions(targetType === "contract" ? row.budgetCategory : "pozostale")}</select></label>`;
    const categoryField = salesInvoice
      ? ""
      : `<label class="${targetType !== "company" ? "is-disabled" : ""}">Kategoria firmowa<select name="company_category" ${targetType !== "company" ? "disabled" : ""}>${invoiceAllocationCategoryOptions(targetType === "company" ? row.category : "")}</select></label>`;
    return `<div class="invoice-allocation-row ${salesInvoice ? "is-sales-invoice" : ""}" data-allocation-row>
      ${targetField}
      <label class="${targetType !== "contract" ? "is-disabled" : ""}">Kontrakt<select name="contract_id" ${targetType !== "contract" ? "disabled" : ""}>${invoiceAllocationContractOptions(targetType === "contract" ? row.contractId : "")}</select></label>
      ${budgetField}
      ${categoryField}
      <label>Netto (zł)<input name="amount" type="number" min="0.01" step="0.01" value="${escapeHtml((Number(row.amountCents || 0) / 100).toFixed(2))}" /></label>
      <button class="allocation-remove" type="button" data-allocation-remove="${index}" aria-label="Usuń część">×</button>
    </div>`;
  }).join("");
  updateInvoiceAllocationTotal();
}

function readInvoiceAllocationRows() {
  if (!invoiceAllocationRows) return [];
  return [...invoiceAllocationRows.querySelectorAll("[data-allocation-row]")].map((row) => ({
    targetType: String(row.querySelector("[name=target_type]")?.value || "contract"),
    contractId: String(row.querySelector("[name=contract_id]")?.value || ""),
    budgetCategory: String(row.querySelector("[name=budget_category]")?.value || "pozostale"),
    category: String(row.querySelector("[name=company_category]")?.value || ""),
    amountCents: toCents(String(row.querySelector("[name=amount]")?.value || "0")),
  }));
}

function updateInvoiceAllocationTotal() {
  if (!invoiceAllocationTotal || !state.pendingInvoiceAllocationId) return;
  const invoice = state.invoices.find((row) => row.id === state.pendingInvoiceAllocationId);
  if (!invoice) return;
  let allocated = 0;
  try { allocated = sum(readInvoiceAllocationRows(), "amountCents"); } catch { /* Validation is shown on save. */ }
  const remaining = Number(invoice.net_amount_cents || 0) - allocated;
  const exact = remaining === 0 && allocated > 0;
  invoiceAllocationTotal.textContent = `Suma części: ${money(allocated)} · do rozliczenia: ${money(Math.max(remaining, 0))}${remaining < 0 ? ` · przekroczenie: ${money(Math.abs(remaining))}` : ""}`;
  invoiceAllocationTotal.className = `invoice-allocation-total ${exact ? "is-valid" : "is-invalid"}`;
}

async function saveInvoiceAllocations() {
  if (!canManageFinance()) throw new Error("Brak uprawnień do rozliczania faktur.");
  const invoice = state.invoices.find((row) => row.id === state.pendingInvoiceAllocationId);
  if (!invoice) throw new Error("Nie znaleziono faktury do rozliczenia.");
  const rows = readInvoiceAllocationRows();
  if (!rows.length) throw new Error("Dodaj co najmniej jedną część rozliczenia.");
  for (const row of rows) {
    if (row.amountCents <= 0) throw new Error("Każda część rozliczenia musi mieć kwotę większą od zera.");
    if (invoice.invoice_type === "sales" && row.targetType !== "contract") throw new Error("FV sprzedażową można przypisać wyłącznie do kontraktu.");
    if (row.targetType === "contract" && !row.contractId) throw new Error("Wybierz kontrakt dla każdej części rozliczenia typu „Kontrakt”.");
    if (row.targetType === "company" && !row.category) throw new Error("Wybierz kategorię dla każdej części rozliczenia typu „Koszt firmowy”.");
  }
  if (sum(rows, "amountCents") !== Number(invoice.net_amount_cents || 0)) {
    throw new Error(`Suma części musi być równa kwocie netto FV: ${money(invoice.net_amount_cents)}.`);
  }
  const { error: deleteError } = await state.supabase.from("invoice_allocations").delete().eq("invoice_id", invoice.id);
  if (deleteError) throw deleteError;
  const payload = rows.map((row) => ({
    invoice_id: invoice.id,
    target_type: row.targetType,
    contract_id: row.targetType === "contract" ? row.contractId : null,
    company_category: row.targetType === "company" ? normalizeCostCategory(row.category) : null,
    budget_category: row.targetType === "contract" ? normalizeContractBudgetCategory(row.budgetCategory) : null,
    net_amount_cents: row.amountCents,
    created_by: state.user.id,
  }));
  const { error: insertError } = await state.supabase.from("invoice_allocations").insert(payload);
  if (insertError) throw insertError;
  const { error: invoiceError } = await state.supabase.from("invoices").update({ allocation: "unassigned", contract_id: null, company_category: null, contract_budget_category: null }).eq("id", invoice.id);
  if (invoiceError) throw invoiceError;
}

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
  if (mode === "settlement") return { table: "settlements", payload: { contract_id: value("contract_id"), period: value("period"), settlement_date: value("settlement_date"), kind: "przerob", net_amount_cents: number("net_amount"), vat_rate: vat(), reference_number: value("reference_number"), budget_category: value("budget_category") || "pozostale" } };
  if (mode === "invoice") {
    const invoiceType = value("invoice_type");
    const allocation = value("allocation");
    const contractId = value("contract_id");
    const category = value("company_category");
    const paymentStatus = value("payment_status");
    const paidAt = ["oplacona", "zaksiegowana"].includes(paymentStatus) ? (value("paid_at") || todayKey()) : null;
    if (invoiceType === "sales" && allocation === "company") throw new Error("FV sprzedażową można przypisać wyłącznie do kontraktu.");
    if (allocation === "contract" && !contractId) throw new Error("Wybierz kontrakt dla tego przypisania.");
    if (allocation === "company" && !category) throw new Error("Podaj kategorię kosztu firmowego.");
    return { table: "invoices", payload: { invoice_type: invoiceType, source: value("source"), document_number: value("document_number"), counterparty: value("counterparty"), counterparty_nip: normalizeNip(value("counterparty_nip")) || null, issue_date: value("issue_date"), due_date: value("due_date") || null, paid_at: paidAt, net_amount_cents: number("net_amount"), vat_rate: vat(), allocation, contract_id: allocation === "contract" ? contractId : null, company_category: allocation === "company" ? category : null, contract_budget_category: allocation === "contract" ? normalizeContractBudgetCategory(value("contract_budget_category")) : null, payment_status: paymentStatus } };
  }
  if (mode === "invoice-rule") {
    const targetType = value("target_type");
    const contractId = value("contract_id");
    const category = value("company_category");
    const nip = normalizeNip(value("match_nip"));
    const matchText = value("match_text");
    const priority = Number(value("priority"));
    if (!nip && !matchText) throw new Error("Podaj NIP kontrahenta albo tekst, którego ma szukać reguła.");
    if (!Number.isInteger(priority) || priority < 0 || priority > 9999) throw new Error("Priorytet musi być liczbą całkowitą od 0 do 9999.");
    if (targetType === "company" && value("invoice_type") !== "purchase") throw new Error("Reguła przypisująca do kosztu firmowego może dotyczyć wyłącznie FV zakupowej.");
    if (targetType === "contract" && !contractId) throw new Error("Wybierz kontrakt będący celem reguły.");
    if (targetType === "company" && !category) throw new Error("Wybierz kategorię firmową będącą celem reguły.");
    return { table: "invoice_assignment_rules", payload: { name: value("name"), active: form.get("active") === "on", priority, invoice_type: value("invoice_type") || null, match_nip: nip || null, match_text: matchText || null, target_type: targetType, contract_id: targetType === "contract" ? contractId : null, company_category: targetType === "company" ? category : null } };
  }
  if (mode === "cost") {
    const paymentStatus = value("payment_status");
    return { table: "company_costs", payload: { cost_date: value("cost_date"), due_date: value("due_date") || null, paid_at: ["oplacona", "zaksiegowana"].includes(paymentStatus) ? (value("paid_at") || todayKey()) : null, category: value("category"), description: value("description"), vendor: value("vendor"), document_number: value("document_number"), net_amount_cents: number("net_amount"), vat_rate: vat(), payment_status: paymentStatus } };
  }
  if (mode === "budget-category") {
    if (!state.contractDetail?.id) throw new Error("Otwórz kartę kontraktu przed ustawieniem budżetu kategorii.");
    return { table: "contract_budget_categories", payload: { contract_id: state.contractDetail.id, category: normalizeContractBudgetCategory(value("category")), planned_cents: number("planned_amount"), notes: value("notes") } };
  }
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
    if (["invoice-month-previous", "invoice-month-next", "cost-month-previous", "cost-month-next", "cashflow-month-previous", "cashflow-month-next"].includes(action)) {
      const kind = action.split("-month-")[0];
      const stateKey = ({ invoice: "invoiceMonth", cost: "costMonth", cashflow: "cashflowMonth" })[kind];
      const direction = action.endsWith("previous") ? -1 : 1;
      const nextMonth = shiftMonth(state[stateKey] || currentMonthKey(), direction);
      const maxMonth = kind === "cashflow" ? shiftMonth(currentMonthKey(), 12) : currentMonthKey();
      if (nextMonth <= maxMonth) state[stateKey] = nextMonth;
      return await loadView(state.supabase);
    }
    if (action === "invoice-type-filter") {
      const selected = element.dataset.invoiceType;
      state.invoiceTypeFilter = ["all", "purchase", "sales"].includes(selected) ? selected : "all";
      return await loadView(state.supabase);
    }
    if (action === "edit-contract") return openEntryModal("contract", state.contractDetail);
    if (action === "delete-contract") return await deleteContract();
    if (action === "manage-user") {
      const user = state.users.find((row) => row.id === id);
      if (user) openEntryModal("manage-user", user);
      return;
    }
    if (action === "allocate-invoice") return openInvoiceAllocationModal(id);
    if (action === "edit-budget-category") {
      if (!canManageContracts()) throw new Error("Brak uprawnień do edycji budżetu kontraktu.");
      const category = normalizeContractBudgetCategory(element.dataset.category);
      const existing = state.budgetCategories.find((row) => row.category === category);
      return openEntryModal("budget-category", existing || { contract_id: state.contractDetail?.id, category });
    }
    if (action === "invoice-attachments") return openInvoiceAttachmentsModal(id);
    if (action === "mark-payment-paid") return await markPaymentPaid(element.dataset.paymentSource, id);
    if (action === "edit-invoice-rule") {
      const rule = state.invoiceRules.find((row) => row.id === id);
      if (rule) openEntryModal("invoice-rule", rule);
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
      if (action === "edit-invoice" && record && invoiceUsesSplit(record)) {
        throw new Error("Ta faktura ma podział na części. Zmień jej przypisania przez przycisk „Rozlicz”; aby zmienić kwotę FV, najpierw usuń podział.");
      }
      if (record) openEntryModal(editable[0], record);
      return;
    }
    if (action === "print-report") return window.print();
    if (action === "export-report") return exportReportCsv();
    if (action === "set-ksef-environment") {
      const environment = element.dataset.ksefEnvironment === "production" ? "production" : "demo";
      if (environment === "production" && !isOwner()) throw new Error("KSeF PRODUKCJA jest dostępny wyłącznie dla właściciela.");
      state.ksefEnvironment = environment;
      state.ksefPreview = [];
      state.ksefPreviewMonth = "";
      state.ksefSelectedNumbers.clear();
      const page = document.querySelector("#page-content");
      if (page && state.activeView === "invoices") page.innerHTML = renderInvoices();
      return;
    }
    if (action === "test-ksef" || action === "test-ksef-demo") return await requestKsefConnectionTest(state.ksefEnvironment);
    if (action === "import-ksef-month") return await importKsefMonth(state.invoiceMonth || currentMonthKey(), "all");
    if (action === "import-ksef-sales") return await importKsefMonth(state.invoiceMonth || currentMonthKey(), "sales");
    if (action === "import-ksef-purchase") return await importKsefMonth(state.invoiceMonth || currentMonthKey(), "purchase");
    if (action === "preview-ksef-invoice") return await showKsefInvoicePreview(id);
    if (action === "delete-invoice") return openInvoiceDeleteModal(id);
    if (action === "preview-ksef-demo") return await requestKsefPreview(state.invoiceMonth || currentMonthKey());
    if (action === "select-all-ksef-preview") return selectAllKsefPreview();
    if (action === "import-ksef-preview") return await importSelectedKsefPreview();
    if (action === "download-document") return await downloadDocument(id);

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
      "delete-settlement": ["settlements", "protokół przerobowy", canManageContracts()],
      "delete-cost": ["company_costs", "koszt firmowy", canManageFinance()],
      "delete-change": ["contract_changes", "pozycję decyzji", canManageContracts()],
      "delete-schedule": ["contract_schedule_items", "zadanie harmonogramu", canManageContracts()],
      "delete-invoice-rule": ["invoice_assignment_rules", "regułę automatycznego przypisania", canManageFinance()],
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

function openInvoiceDeleteModal(invoiceId) {
  if (!isOwner()) throw new Error("Fakturę może usunąć wyłącznie właściciel.");
  if (!state.invoices.some((row) => row.id === invoiceId)) throw new Error("Nie znaleziono faktury do usunięcia.");
  state.pendingInvoiceDeleteId = invoiceId;
  invoiceDeleteForm?.reset();
  if (invoiceDeleteError) invoiceDeleteError.hidden = true;
  invoiceDeleteModal?.showModal();
  window.setTimeout(() => invoiceDeleteForm?.querySelector("input[name=password]")?.focus(), 0);
}

async function deleteInvoiceWithPassword(password) {
  if (!isOwner()) throw new Error("Fakturę może usunąć wyłącznie właściciel.");
  if (!state.pendingInvoiceDeleteId) throw new Error("Wybierz fakturę do usunięcia.");
  if (!password) throw new Error("Podaj hasło właściciela.");

  const { data: { session } } = await state.supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sesja użytkownika wygasła. Zaloguj się ponownie.");

  const response = await fetch("/api/delete-invoice", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ invoiceId: state.pendingInvoiceDeleteId, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Nie udało się usunąć faktury.");
}

function openInvoiceAttachmentsModal(invoiceId) {
  if (!invoiceAttachmentsModal || !invoiceAttachmentsContent) throw new Error("Nie można otworzyć załączników faktury.");
  const invoice = state.invoices.find((row) => row.id === invoiceId);
  if (!invoice) throw new Error("Nie znaleziono faktury.");
  if (invoice.source === "ksef") throw new Error("Skan i OCR są przeznaczone dla dokumentów dodawanych ręcznie. Faktura z KSeF ma podgląd pobierany bezpośrednio z KSeF.");
  state.pendingInvoiceAttachmentId = invoiceId;
  const files = (state.invoiceAttachments || []).filter((row) => row.invoice_id === invoiceId);
  invoiceAttachmentsContent.innerHTML = `<div class="invoice-attachments-heading"><div><p class="eyebrow">SKAN DOKUMENTU / OCR</p><h3>${escapeHtml(invoice.document_number)}</h3><p>${escapeHtml(invoice.counterparty || "Brak kontrahenta")}</p></div>${canManageFinance() ? `<button class="button button-primary" type="button" data-invoice-attachment-action="upload">+ Dodaj skan</button>` : ""}</div><div class="invoice-attachments-ocr-note"><strong>OCR</strong><span>Dodaj skan ręcznie wystawionej FV albo paragonu z NIP. Kolejka OCR jest zapisywana w PrądPlan; automatyczne odczytywanie wymaga późniejszego podłączenia dostawcy OCR.</span></div>${files.length ? `<div class="invoice-attachment-list">${files.map(invoiceAttachmentRow).join("")}</div>` : emptyState("Nie dodano jeszcze skanu do tej faktury.")}`;
  if (!invoiceAttachmentsModal.open) invoiceAttachmentsModal.showModal();
}

function invoiceAttachmentRow(row) {
  const controls = `<button class="table-action" type="button" data-invoice-attachment-action="download" data-id="${row.id}">Otwórz</button>${canManageFinance() ? `${row.ocr_status === "not_requested" ? `<button class="table-action" type="button" data-invoice-attachment-action="queue-ocr" data-id="${row.id}">Do OCR</button>` : ""}<button class="table-action danger" type="button" data-invoice-attachment-action="delete" data-id="${row.id}">Usuń</button>` : ""}`;
  return `<article class="invoice-attachment-row"><div><strong>${escapeHtml(row.label || row.file_name)}</strong><small>${escapeHtml(row.file_name)} · ${fileSize(row.size_bytes)} · ${dateTime(row.created_at)}</small></div><div class="row-actions"><span class="tag ${ocrStatusClass(row.ocr_status)}">${escapeHtml(ocrStatusLabel(row.ocr_status))}</span>${controls}</div></article>`;
}

function ocrStatusLabel(value) {
  return ({ not_requested: "Gotowe do OCR", queued: "W kolejce OCR", completed: "Odczytano", failed: "Błąd OCR" })[value] || "Gotowe do OCR";
}

function ocrStatusClass(value) {
  return ({ not_requested: "tag-yellow", queued: "tag-blue", completed: "tag-green", failed: "tag-red" })[value] || "tag-yellow";
}

async function saveInvoiceAttachment(form) {
  if (!canManageFinance()) throw new Error("Brak uprawnień do dodawania załączników FV.");
  const invoiceId = state.pendingInvoiceAttachmentId;
  if (!invoiceId) throw new Error("Najpierw wybierz fakturę.");
  const file = form.get("file");
  return uploadInvoiceAttachmentFile(invoiceId, file, String(form.get("label") || "").trim(), "not_requested");
}

async function uploadInvoiceAttachmentFile(invoiceId, file, label = "", ocrStatus = "not_requested") {
  if (!(file instanceof File) || !file.size) throw new Error("Wybierz plik do wysłania.");
  if (file.size > 15728640) throw new Error("Plik jest większy niż dozwolone 15 MB.");
  const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) throw new Error("Dozwolone są wyłącznie pliki PDF, JPG, PNG i WEBP.");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "zalacznik";
  const unique = globalThis.crypto?.randomUUID?.() || String(Date.now());
  const storagePath = `${invoiceId}/${unique}-${safeName}`;
  const { error: uploadError } = await state.supabase.storage.from("invoice-attachments").upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;
  const { error: recordError } = await state.supabase.from("invoice_attachments").insert({
    invoice_id: invoiceId,
    file_name: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    size_bytes: file.size,
    label,
    ocr_status: ocrStatus,
    uploaded_by: state.user.id,
  });
  if (recordError) {
    await state.supabase.storage.from("invoice-attachments").remove([storagePath]);
    throw recordError;
  }
}

async function downloadInvoiceAttachment(id) {
  const attachment = state.invoiceAttachments.find((row) => row.id === id);
  if (!attachment) throw new Error("Nie znaleziono załącznika.");
  const { data, error } = await state.supabase.storage.from("invoice-attachments").createSignedUrl(attachment.storage_path, 60);
  if (error) throw error;
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

async function updateInvoiceAttachmentOcr(id) {
  if (!canManageFinance()) throw new Error("Brak uprawnień do kolejki OCR.");
  const { error } = await state.supabase.from("invoice_attachments").update({ ocr_status: "queued" }).eq("id", id);
  if (error) throw error;
  const attachment = state.invoiceAttachments.find((row) => row.id === id);
  if (attachment) attachment.ocr_status = "queued";
  if (state.pendingInvoiceAttachmentId) openInvoiceAttachmentsModal(state.pendingInvoiceAttachmentId);
}

async function deleteInvoiceAttachment(id) {
  if (!canManageFinance()) throw new Error("Brak uprawnień do usuwania załączników FV.");
  const attachment = state.invoiceAttachments.find((row) => row.id === id);
  if (!attachment) throw new Error("Nie znaleziono załącznika.");
  if (!window.confirm(`Czy na pewno usunąć plik „${attachment.file_name}”?`)) return;
  const { error: storageError } = await state.supabase.storage.from("invoice-attachments").remove([attachment.storage_path]);
  if (storageError) throw storageError;
  const { error } = await state.supabase.from("invoice_attachments").delete().eq("id", id);
  if (error) throw error;
  state.invoiceAttachments = state.invoiceAttachments.filter((row) => row.id !== id);
  if (state.pendingInvoiceAttachmentId) openInvoiceAttachmentsModal(state.pendingInvoiceAttachmentId);
}

async function markPaymentPaid(source, id) {
  if (!canManageFinance()) throw new Error("Brak uprawnień do zmiany statusu płatności.");
  const table = source === "cost" ? "company_costs" : "invoices";
  const { error } = await state.supabase.from(table).update({ payment_status: "oplacona", paid_at: todayKey() }).eq("id", id);
  if (error) throw error;
  await loadView(state.supabase);
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
  const message = `Czy na pewno usunąć kontrakt „${contract.name}”? Usunięte zostaną jego protokoły przerobowe, zmiany i dokumenty. Faktury pozostaną w rejestrze jako nieprzypisane.`;
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

async function requestKsefConnectionTest(environment = "demo") {
  if (!canManageFinance()) throw new Error("Brak uprawnień do testu KSeF.");
  if (environment === "production" && !isOwner()) throw new Error("KSeF PRODUKCJA jest dostępny wyłącznie dla właściciela.");
  const { data: { session } } = await state.supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sesja wygasła. Zaloguj się ponownie.");
  const response = await fetch("/api/ksef-test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ environment }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error || "Nie udało się uruchomić testu KSeF.");
  window.alert(data?.message || "Zlecono sprawdzenie połączenia KSeF.");
  await loadView(state.supabase);
}

async function requestKsefPreview(month) {
  if (!canManageFinance()) throw new Error("Brak uprawnień do podglądu KSeF.");
  if (state.ksefEnvironment === "production" && !isOwner()) throw new Error("KSeF PRODUKCJA jest dostępny wyłącznie dla właściciela.");
  const { data: { session } } = await state.supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sesja wygasła. Zaloguj się ponownie.");
  const response = await fetch("/api/ksef-preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ month, environment: state.ksefEnvironment }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error || "Nie udało się pobrać podglądu KSeF.");
  state.ksefPreview = Array.isArray(data?.invoices) ? data.invoices : [];
  state.ksefPreviewMonth = data?.month || month;
  state.ksefPreviewLimited = Boolean(data?.limited);
  state.ksefSelectedNumbers.clear();
  window.alert(data?.message || `Pobrano podgląd faktur z ${ksefEnvironmentLabel()}.`);
  await loadView(state.supabase);
}

function selectAllKsefPreview() {
  const imported = new Set(state.invoices
    .filter((row) => row.ksef_environment === state.ksefEnvironment)
    .map((row) => row.ksef_number)
    .filter(Boolean));
  for (const row of state.ksefPreview) {
    if (!imported.has(row.ksefNumber)) state.ksefSelectedNumbers.add(row.ksefNumber);
  }
  const page = document.querySelector("#page-content");
  if (page && state.activeView === "invoices") page.innerHTML = renderInvoices();
}

async function importSelectedKsefPreview() {
  if (!canManageFinance()) throw new Error("Brak uprawnień do importu KSeF.");
  if (state.ksefEnvironment === "production" && !isOwner()) throw new Error("KSeF PRODUKCJA jest dostępny wyłącznie dla właściciela.");
  const month = state.ksefPreviewMonth;
  const ksefNumbers = state.ksefPreview
    .filter((row) => state.ksefSelectedNumbers.has(row.ksefNumber))
    .map((row) => row.ksefNumber);
  if (!month || !ksefNumbers.length) throw new Error("Zaznacz co najmniej jedną fakturę do importu.");
  if (!window.confirm(`Zaimportować ${ksefNumbers.length} zaznaczonych faktur z ${ksefEnvironmentLabel()} do rejestru PrądPlan? Zostaną dodane jako nieprzypisane.`)) return;
  const { data: { session } } = await state.supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sesja wygasła. Zaloguj się ponownie.");
  const data = await requestKsefImport(session.access_token, { month, ksefNumbers, environment: state.ksefEnvironment });
  state.ksefSelectedNumbers.clear();
  window.alert(data?.message || `Zaimportowano wybrane faktury z ${ksefEnvironmentLabel()}.`);
  await loadView(state.supabase);
}

async function requestKsefImport(accessToken, payload) {
  const response = await fetch("/api/ksef-import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error || `Nie udało się zaimportować faktur z ${ksefEnvironmentLabel()}.`);
  return data;
}

async function importKsefMonth(month, invoiceType = "all") {
  if (!canManageFinance()) throw new Error("Brak uprawnień do importu KSeF.");
  if (state.ksefEnvironment === "production" && !isOwner()) throw new Error("KSeF PRODUKCJA jest dostępny wyłącznie dla właściciela.");
  const typeLabel = invoiceType === "sales" ? "FV sprzedażowe" : invoiceType === "purchase" ? "FV zakupowe" : "wszystkie FV";
  if (!window.confirm(`Zaimportować ${typeLabel} z ${ksefEnvironmentLabel()} za ${monthLabel(month)}? Dokumenty już obecne w PrądPlan w tym środowisku zostaną pominięte.`)) return;
  const { data: { session } } = await state.supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sesja wygasła. Zaloguj się ponownie.");

  setImportProgress(`Trwa pobieranie i importowanie z ${ksefEnvironmentLabel()}: ${typeLabel}…`, true);
  try {
    let totalImported = 0;
    let totalDetailsSynced = 0;
    let detailsPending = 0;
    let lastMessage = "";
    let batchesCompleted = 0;

    for (let batch = 0; batch < MAX_KSEF_DETAIL_BATCHES; batch += 1) {
      setImportProgress(batch
        ? `Uzupełnianie terminów płatności i pozycji FV — pakiet ${batch + 1}…`
        : `Trwa pobieranie i importowanie z ${ksefEnvironmentLabel()}: ${typeLabel}…`, true);
      const data = await requestKsefImport(session.access_token, { month, invoiceType, environment: state.ksefEnvironment });
      totalImported += Number(data?.imported || 0);
      totalDetailsSynced += Number(data?.detailsSynced || 0);
      detailsPending = Number(data?.detailsPending || 0);
      lastMessage = data?.message || lastMessage;
      batchesCompleted += 1;
      // Zatrzymujemy pętlę, gdy wszystko jest gotowe lub KSeF nie pozwolił
      // odczytać żadnej pozycji w danym pakiecie.
      if (!detailsPending || !Number(data?.detailsSynced || 0)) break;
    }
    state.ksefSelectedNumbers.clear();
    if (["sales", "purchase"].includes(invoiceType)) state.invoiceTypeFilter = invoiceType;
    const batchMessage = batchesCompleted > 1
      ? `Zaimportowano ${totalImported} faktur do rejestru PrądPlan. Uzupełniono dane XML, pozycje i terminy płatności dla ${totalDetailsSynced} faktur.${detailsPending ? ` Pozostało ${detailsPending} dokumentów do uzupełnienia — uruchom import ponownie.` : ""}`
      : lastMessage || `Zaimportowano faktury z ${ksefEnvironmentLabel()}.`;
    window.alert(batchMessage);
    await loadView(state.supabase);
  } finally {
    setImportProgress("", false);
  }
}

async function showKsefInvoicePreview(id) {
  if (!canManageFinance()) throw new Error("Brak uprawnień do podglądu faktury KSeF.");
  const savedInvoice = state.invoices.find((row) => row.id === id);
  if (!savedInvoice?.ksef_number) throw new Error("Podgląd jest dostępny tylko dla faktur zaimportowanych z KSeF.");
  const environment = savedInvoice.ksef_environment === "production" ? "production" : "demo";
  const label = ksefEnvironmentLabel(environment);
  if (environment === "production" && !isOwner()) throw new Error("Podgląd faktury z KSeF PRODUKCJA jest dostępny wyłącznie dla właściciela.");
  const { data: { session } } = await state.supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sesja wygasła. Zaloguj się ponownie.");
  if (!invoicePreviewModal || !invoicePreviewContent) throw new Error("Nie można otworzyć okna podglądu.");

  invoicePreviewContent.innerHTML = `<div class="invoice-preview-loading">Pobieranie wizualizacji faktury z ${escapeHtml(label)}…</div>`;
  invoicePreviewModal.showModal();
  setImportProgress(`Trwa pobieranie wizualizacji faktury z ${label}…`, true);
  try {
    const response = await fetch("/api/ksef-invoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ invoiceId: id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error || !data?.invoice) {
      throw new Error(data?.error || `Nie udało się pobrać wizualizacji faktury z ${label}.`);
    }
    invoicePreviewContent.innerHTML = renderKsefInvoiceVisualization(data.invoice, data?.environment || environment);
  } catch (error) {
    invoicePreviewContent.innerHTML = `<div class="notice">${escapeHtml(error.message || "Nie udało się pobrać wizualizacji faktury.")}</div>`;
  } finally {
    setImportProgress("", false);
  }
}

function renderKsefInvoiceVisualization(invoice, environment = "demo") {
  const currency = typeof invoice?.currency === "string" && invoice.currency ? invoice.currency : "PLN";
  const rows = Array.isArray(invoice?.items) ? invoice.items : [];
  const paymentDetails = [
    invoice?.dueDate ? `Termin płatności: <strong>${escapeHtml(date(invoice.dueDate))}</strong>` : "Termin płatności nie został podany w dokumencie.",
    invoice?.payment?.account ? `Rachunek: <strong>${escapeHtml(String(invoice.payment.account))}</strong>` : "",
  ].filter(Boolean).join("<br />");
  const itemRows = rows.length
    ? rows.map((row) => `<tr><td>${escapeHtml(String(row?.name || "Pozycja faktury"))}</td><td class="align-right">${escapeHtml(String(row?.quantity || "—"))}</td><td>${escapeHtml(String(row?.unit || "—"))}</td><td>${escapeHtml(vatRateLabel(row?.vatRate))}</td><td class="align-right">${ksefPreviewMoney(row?.netAmount, currency)}</td><td class="align-right">${ksefPreviewMoney(row?.vatAmount, currency)}</td><td class="align-right">${ksefPreviewMoney(row?.grossAmount, currency)}</td></tr>`).join("")
    : `<tr><td class="invoice-preview-empty" colspan="7">W XML tej faktury nie ma pozycji do pokazania.</td></tr>`;

  return `<article class="invoice-preview-paper">
    <header class="invoice-preview-paper-header">
      <div><p class="eyebrow">${escapeHtml(ksefEnvironmentLabel(environment))} / ${escapeHtml(String(invoice?.kind || "FAKTURA"))}</p><h3>Faktura ${escapeHtml(String(invoice?.number || "—"))}</h3></div>
      <div class="invoice-preview-number"><span>Data wystawienia</span><strong>${escapeHtml(date(invoice?.issueDate))}</strong><span>Numer KSeF</span><strong>${escapeHtml(String(invoice?.ksefNumber || "—"))}</strong></div>
    </header>
    <div class="invoice-preview-party-grid">
      ${invoicePreviewParty("Sprzedawca", invoice?.seller)}
      ${invoicePreviewParty("Nabywca", invoice?.buyer)}
      ${invoicePreviewParty("Odbiorca", invoice?.recipient)}
    </div>
    <div class="invoice-preview-table-wrap"><table class="invoice-preview-table"><thead><tr><th>Pozycja</th><th class="align-right">Ilość</th><th>Jednostka</th><th>VAT</th><th class="align-right">Netto</th><th class="align-right">Podatek VAT</th><th class="align-right">Brutto</th></tr></thead><tbody>${itemRows}</tbody></table></div>
    <footer class="invoice-preview-footer">
      <div class="invoice-preview-payment"><h4>Płatność</h4>${paymentDetails}</div>
      <div class="invoice-preview-totals">
        <div class="invoice-preview-total"><span>Razem netto</span><strong>${ksefPreviewMoney(invoice?.totals?.netAmount, currency)}</strong></div>
        <div class="invoice-preview-total"><span>Razem podatek VAT</span><strong>${ksefPreviewMoney(invoice?.totals?.vatAmount, currency)}</strong></div>
        <div class="invoice-preview-total invoice-preview-total-grand"><span>Do zapłaty</span><strong>${ksefPreviewMoney(invoice?.totals?.grossAmount, currency)}</strong></div>
      </div>
    </footer>
  </article>`;
}

function invoicePreviewParty(title, party) {
  return `<section class="invoice-preview-party"><h4>${escapeHtml(title)}</h4><strong>${escapeHtml(String(party?.name || "—"))}</strong>${party?.nip ? `<span>NIP: ${escapeHtml(String(party.nip))}</span>` : ""}${party?.address ? `<span>${escapeHtml(String(party.address))}</span>` : ""}</section>`;
}

function ksefPreviewMoney(value, currency = "PLN") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${escapeHtml(currency)}`;
  }
}

function vatRateLabel(value) {
  const rate = String(value || "").trim();
  return /^\d+(?:[.,]\d+)?$/.test(rate) ? `${rate}%` : rate || "—";
}

function paymentFormLabel(value, otherDescription) {
  const forms = {
    "1": "Gotówka",
    "2": "Karta",
    "3": "Bon",
    "4": "Czek",
    "5": "Kredyt",
    "6": "Przelew",
    "7": "Płatność mobilna",
  };
  const code = String(value || "").trim();
  return forms[code] || String(otherDescription || "Inna forma płatności").trim();
}

function downloadKsefInvoicePdf() {
  const paper = invoicePreviewContent?.querySelector(".invoice-preview-paper");
  if (!paper) throw new Error("Najpierw otwórz gotowy podgląd faktury.");
  const popup = window.open("", "_blank", "popup,width=1100,height=820");
  if (!popup) throw new Error("Przeglądarka zablokowała okno zapisu PDF. Zezwól na wyskakujące okna dla PrądPlan.");
  const documentNumber = paper.querySelector("h3")?.textContent?.replace(/[^a-zA-Z0-9._-]+/g, "-") || "faktura";
  const printStyles = `
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111; background: #fff; font-family: Inter, Arial, sans-serif; }
    .invoice-preview-paper { border: 1px solid #d9d9d7; background: #fff; }
    .invoice-preview-paper-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 24px 26px; border-bottom: 4px solid #ffd600; }
    .eyebrow { margin: 0; color: #906b00; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h3 { margin: 6px 0 0; font-size: 28px; letter-spacing: -.04em; }
    .invoice-preview-number { color: #5f6166; font-size: 12px; text-align: right; line-height: 1.55; }
    .invoice-preview-number strong { display: block; color: #111; font-size: 14px; }
    .invoice-preview-party-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 20px 26px; background: #fcfcfa; }
    .invoice-preview-party { min-width: 0; padding: 13px; border: 1px solid #e1e1df; background: #fff; }
    .invoice-preview-party h4, .invoice-preview-payment h4 { margin: 0 0 9px; color: #5f6166; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
    .invoice-preview-party strong, .invoice-preview-party span { display: block; overflow-wrap: anywhere; }
    .invoice-preview-party strong { font-size: 12px; }
    .invoice-preview-party span { margin-top: 3px; color: #5f6166; font-size: 10px; line-height: 1.4; }
    .invoice-preview-table-wrap { padding: 0 26px 22px; }
    .invoice-preview-table { width: 100%; border-collapse: collapse; }
    .invoice-preview-table th { padding: 10px 8px; color: #5f6166; background: #f3f3f0; font-size: 9px; letter-spacing: .06em; text-align: left; text-transform: uppercase; }
    .invoice-preview-table td { padding: 11px 8px; border-bottom: 1px solid #e5e5e2; font-size: 11px; vertical-align: top; }
    .align-right { text-align: right !important; white-space: nowrap; }
    .invoice-preview-footer { display: grid; grid-template-columns: minmax(0, 1fr) minmax(190px, .5fr); gap: 20px; align-items: start; padding: 0 26px 26px; }
    .invoice-preview-payment { padding: 14px; border-left: 4px solid #ffd600; background: #fff9dd; color: #5f6166; font-size: 11px; line-height: 1.5; }
    .invoice-preview-payment strong { color: #111; }
    .invoice-preview-totals { border: 1px solid #d9d9d7; }
    .invoice-preview-total { display: flex; justify-content: space-between; gap: 20px; padding: 10px 12px; border-top: 1px solid #e4e4e1; font-size: 11px; }
    .invoice-preview-total:first-child { border-top: 0; }
    .invoice-preview-total-grand { background: #fff1ad; font-size: 13px; font-weight: 800; }
  `;
  popup.document.title = documentNumber;
  popup.document.write(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${escapeHtml(documentNumber)}</title><style>${printStyles}</style></head><body>${paper.outerHTML}</body></html>`);
  popup.document.close();
  let printed = false;
  const print = () => {
    if (printed) return;
    printed = true;
    popup.focus();
    popup.print();
  };
  popup.addEventListener("load", print, { once: true });
  window.setTimeout(print, 350);
}

function setImportProgress(message, visible) {
  if (!importToast || !importToastMessage) return;
  importToastMessage.textContent = message;
  importToast.hidden = !visible;
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

function collectAlerts({ contracts, invoices, schedule, changes }) {
  const alerts = [];
  const today = new Date().toISOString().slice(0, 10);
  const soon = addDays(today, 14);
  const contractById = new Map(contracts.map((row) => [row.id, row]));
  const add = (severity, title, message, contractId = null, view = "") => alerts.push({ id: `${severity}-${alerts.length}`, severity, title, message, contractId, view, actionLabel: view === "invoices" ? "Otwórz faktury" : "Otwórz" });

  for (const contract of contracts) {
    if (contract.status === "zakonczony") continue;
    if (contract.due_date && contract.due_date < today) add("critical", "Przekroczony termin kontraktu", `${contract.name} — termin umowny: ${date(contract.due_date)}.`, contract.id);
    else if (contract.due_date && contract.due_date <= soon) add("warning", "Zbliża się termin kontraktu", `${contract.name} — termin umowny: ${date(contract.due_date)}.`, contract.id);

    const invoiceCosts = sum(invoices.filter((row) => row.contract_id === contract.id && row.invoice_type === "purchase"), "net_amount_cents");
    const costs = invoiceCosts;
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
    if (invoiceNeedsResolution(invoice)) add("warning", "Faktura do rozliczenia", `${invoice.document_number || "Faktura"} od ${invoice.counterparty || "kontrahenta"} wymaga przypisania do kontraktu lub kosztów firmy.`, null, "invoices");
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
function normalizeNip(value) { return String(value || "").replace(/\D/g, ""); }
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
function moneyExact(cents) { return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(cents || 0) / 100); }
function moneyKsef(amount, currency = "PLN") {
  const value = Number(amount || 0);
  const code = /^[A-Z]{3}$/.test(String(currency)) ? String(currency) : "PLN";
  try { return new Intl.NumberFormat("pl-PL", { style: "currency", currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
  catch { return `${value.toFixed(2).replace(".", ",")} ${escapeHtml(code)}`; }
}
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
