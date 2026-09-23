# PrądPlan — pakiet do wdrożenia

To jest niezależna, statyczna wersja PrądPlan do wdrożenia w modelu:

**prywatne repozytorium GitHub → Vercel → Supabase → `pradplan.etwgroup.pl`**

Nie wymaga Node.js, `npm`, procesu budowania ani Cloudflare D1. Vercel publikuje
pliki HTML, CSS i JavaScript wprost z katalogu głównego. Dane użytkowników i
firmowe pozostają w Supabase.

## Zawartość pakietu

```text
pradplan-production/
├── index.html                         aplikacja
├── styles.css                         wspólny wygląd ETW / PrądPlan
├── app.js                             logowanie, widoki, formularze i Supabase
├── package.json                       zależności bezpiecznego testu KSeF na Vercel
├── api/ksef-test.ts                   test uwierzytelnienia KSeF w Node.js
├── api/ksef-preview.ts                podgląd metadanych KSeF (DEMO/PRODUKCJA)
├── api/ksef-import.ts                 import miesięczny KSeF (wyłącznie odczyt)
├── api/ksef-invoice.ts                bezpieczna wizualizacja XML faktury KSeF
├── api/delete-invoice.ts              usuwanie FV przez właściciela po haśle
├── config.js                          jedyne miejsce na publiczną konfigurację
└── supabase/
    ├── migrations/
    │   ├── 001_initial_schema.sql     tabele, role i RLS
    │   ├── 002_audit_log.sql          historia zmian
    │   ├── 003_invoice_import.sql     przygotowanie importu KSeF
    │   ├── 004_authenticated_grants.sql uprawnienia do odczytu i zapisu przez API
    │   ├── 005_contract_operations.sql karta kontraktu, akceptacje i dokumenty
    │   ├── 006_contract_storage.sql   prywatny magazyn dokumentów
    │   ├── 007_contract_schedules.sql harmonogramy kontraktów
    │   ├── 008_schedule_gantt.sql    kamienie milowe i zależności Gantta
    │   ├── 009_contract_retention.sql kaucja gwarancyjna kontraktu
    │   ├── 010_ksef_demo_environment.sql środowisko DEMO KSeF
    │   ├── 011_invoice_delete_owner_password.sql blokada bezpośredniego usuwania FV
    │   ├── 012_invoice_delete_service_role_grant.sql prawo DELETE wyłącznie dla serwera
    │   ├── 013_invoice_delete_service_role_schema_access.sql dostęp serwera do schematu public
    │   ├── 014_invoice_delete_service_role_select.sql odczyt techniczny dla usuwania FV
    │   ├── 015_invoice_allocation_workflow.sql podział FV, reguły i skrzynka rozliczeń
    │   ├── 016_cashflow_budget_attachments.sql płatności, budżety kategorii i załączniki FV
    │   └── 017_ksef_production_environment.sql rozdzielenie DEMO i PRODUKCJI KSeF
    └── functions/
        ├── admin-users/               bezpieczne tworzenie kont przez właściciela
        └── import-ksef/               bezpieczna bramka do importu KSeF
```

## 1. Utwórz projekt Supabase

1. Zaloguj się na [Supabase](https://supabase.com/dashboard) i wybierz **New project**.
2. Nadaj mu nazwę `pradplan-production`, wybierz region europejski i zachowaj hasło bazy w menedżerze haseł.
3. Po gotowości projektu przejdź do **SQL Editor**.
4. Uruchom zawartość migracji dokładnie w tej kolejności:

   1. `supabase/migrations/001_initial_schema.sql`
   2. `supabase/migrations/002_audit_log.sql`
   3. `supabase/migrations/003_invoice_import.sql`
   4. `supabase/migrations/004_authenticated_grants.sql`
   5. `supabase/migrations/005_contract_operations.sql`
   6. `supabase/migrations/006_contract_storage.sql`
   7. `supabase/migrations/007_contract_schedules.sql`
   8. `supabase/migrations/008_schedule_gantt.sql`
   9. `supabase/migrations/009_contract_retention.sql`
   10. `supabase/migrations/010_ksef_demo_environment.sql`
   11. `supabase/migrations/011_invoice_delete_owner_password.sql`
   12. `supabase/migrations/012_invoice_delete_service_role_grant.sql`
   13. `supabase/migrations/013_invoice_delete_service_role_schema_access.sql`
   14. `supabase/migrations/014_invoice_delete_service_role_select.sql`
   15. `supabase/migrations/015_invoice_allocation_workflow.sql`
   16. `supabase/migrations/016_cashflow_budget_attachments.sql`
   17. `supabase/migrations/017_ksef_production_environment.sql`

Każdy plik wklej jako osobne zapytanie i wybierz **Run**. Nie uruchamiaj tych
migracji w istniejącym projekcie z inną strukturą bez wcześniejszej kopii bazy.

Migracja `001` tworzy: kontrakty, protokoły przerobowe, faktury, koszty firmowe,
profile, role oraz zasady RLS. RLS wymusza dostęp do danych także wtedy, gdy
ktoś otworzy narzędzia przeglądarki.

Jeśli widzisz komunikat `permission denied for table profiles`, uruchom
migrację `004_authenticated_grants.sql`, a następnie odśwież aplikację.

## 2. Utwórz pierwszego użytkownika i ustaw właściciela

1. W Supabase przejdź do **Authentication → Users → Add user**.
2. Utwórz konto e-mail/hasło dla administratora PrądPlan.
3. W **SQL Editor** uruchom poniższe zapytanie, podstawiając adres tego konta:

```sql
update public.profiles
set role = 'owner', active = true
where email = 'twoj-adres@etwgroup.pl';
```

Jeżeli konto utworzono przed uruchomieniem migracji `001`, profil mógł nie
powstać automatycznie. Wtedy zamiast powyższego `UPDATE` uruchom jednorazowo:

```sql
insert into public.profiles (id, email, full_name, role, active)
select id, email, coalesce(raw_user_meta_data ->> 'full_name', ''), 'owner', true
from auth.users
where email = 'twoj-adres@etwgroup.pl'
on conflict (id) do update
set role = 'owner', active = true;
```

Po wdrożeniu funkcji `admin-users` (opis poniżej) kolejne konta można tworzyć
bezpośrednio w zakładce **Zespół i uprawnienia**. Do czasu wdrożenia tej funkcji
utwórz konto w **Authentication → Users**, a następnie nadaj mu rolę w SQL Editor.

| Rola | Uprawnienia |
| --- | --- |
| `owner` | pełny dostęp, role użytkowników i historia zmian |
| `manager` | tworzenie i zmiana kontraktów oraz rozliczeń |
| `accountant` | tworzenie i zmiana faktur oraz kosztów firmowych |
| `viewer` | wyłącznie odczyt |

Przykład dla kierownika:

```sql
update public.profiles
set role = 'manager', active = true
where email = 'kierownik@etwgroup.pl';
```

## 3. Ustaw połączenie aplikacji z Supabase

1. W Supabase otwórz **Project Settings → API**.
2. Skopiuj **Project URL** i **Publishable key** (w starszych projektach: `anon` key).
3. Otwórz `config.js` i wstaw wartości:

```js
window.ETW_CONFIG = {
  supabaseUrl: "https://twoj-projekt.supabase.co",
  supabasePublishableKey: "sb_publishable_...",
};
```

Klucz Publishable/anon może być w kodzie strony — jego uprawnienia ogranicza
RLS. **Nigdy nie wpisuj do `config.js` klucza `service_role`**, hasła do bazy,
tokenu KSeF ani certyfikatu.

Adres musi być samym adresem projektu, np. `https://abcxyz.supabase.co` — bez
`/rest/v1`, `/auth/v1` ani adresu panelu `supabase.com/dashboard/...`.

## 4. Umieść kod w prywatnym GitHubie

1. Utwórz prywatne repozytorium, np. `etwgroup/pradplan`.
2. Wgraj **zawartość** katalogu `pradplan-production` do katalogu głównego repozytorium. Po wgraniu plik powinien mieć ścieżkę `index.html`, a nie `pradplan-production/index.html`.
3. Zacommituj i wypchnij pliki na gałąź `main`.

Nowo utworzone konto jest nieaktywne, więc nie odczyta danych przed decyzją
właściciela. To zabezpiecza bazę również wtedy, gdy ustawienia Supabase
przypadkowo pozwolą na samodzielną rejestrację. Dodatkowo w **Authentication →
Providers → Email** wyłącz publiczne rejestracje, jeśli aplikacja ma być
dostępna wyłącznie dla zespołu ETW.

Przykładowe polecenia wykonywane lokalnie w katalogu pakietu:

```bash
git init
git add .
git commit -m "Initial PradPlan deployment"
git branch -M main
git remote add origin git@github.com:ETW-GROUP/pradplan.git
git push -u origin main
```

Adres organizacji i repozytorium w ostatnich dwóch poleceniach zastąp właściwym
adresem GitHub. Repozytorium musi pozostać prywatne.

## 5. Wdrożenie na Vercel

1. Wejdź na [Vercel](https://vercel.com) i wybierz **Add New → Project**.
2. Zaimportuj prywatne repozytorium `pradplan`.
3. Ustaw:

   - **Framework Preset:** `Other`
   - **Root Directory:** `./`
   - **Build Command:** puste
   - **Output Directory:** puste

4. Wybierz **Deploy**.

Każdy kolejny `git push` do `main` będzie automatycznie publikował nową wersję.

## 6. Podłącz domenę

W Vercel wejdź w **Settings → Domains**, dodaj `pradplan.etwgroup.pl` i wykonaj
dokładnie rekord DNS pokazany przez Vercel w panelu domeny `etwgroup.pl`.

Po propagacji certyfikat HTTPS zostanie wystawiony automatycznie. Ustaw
`pradplan.etwgroup.pl` jako domenę produkcyjną projektu.

## 7. Kontrola po wdrożeniu

1. Otwórz `https://pradplan.etwgroup.pl`.
2. Zaloguj się kontem właściciela.
3. Dodaj testowy kontrakt, następnie rozliczenie i fakturę.
4. Sprawdź, czy użytkownik `viewer` widzi dane, ale nie widzi przycisków dodawania.
5. Usuń testowe dane z panelu Supabase, jeśli nie są potrzebne.

## 8. Funkcje serwerowe: konta i KSeF

Funkcje w `supabase/functions/` nie są publikowane przez Vercel — wdraża się je
do tego samego projektu Supabase. W katalogu zawierającym folder `supabase/`
zaloguj się do Supabase CLI, połącz projekt i uruchom:

```bash
supabase login
supabase link --project-ref TWOJ_PROJECT_REF
supabase functions deploy admin-users
supabase functions deploy import-ksef
```

### Test KSeF DEMO

Test KSeF działa przez `api/ksef-test.ts`, czyli funkcję Node.js publikowaną
automatycznie przez Vercel wraz z aplikacją. To omija różnicę w obsłudze krzywej
ECDSA P-256 między KSeF a Supabase Edge Runtime. Przed wdrożeniem dodaj w
**Vercel → Settings → Environment Variables** (dla `Production`) poniższe
wartości. Nie wpisuj ich do plików repozytorium:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
KSEF_DEMO_NIP
KSEF_DEMO_CERTIFICATE_BASE64
KSEF_DEMO_PRIVATE_KEY_BASE64
KSEF_DEMO_PRIVATE_KEY_PASSWORD
SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_URL` to adres projektu bez `/rest/v1`, a `SUPABASE_PUBLISHABLE_KEY`
to ten sam klucz Publishable użyty w `config.js`. Pozostałe cztery wartości są
tymi samymi sekretami KSeF DEMO, które były przygotowane w Supabase. Klucz i
hasło są dostępne wyłącznie dla funkcji serwerowej Vercel.

`SUPABASE_SERVICE_ROLE_KEY` pobierz z **Supabase → Project Settings → API →
Secret keys** i dodaj tylko jako zmienną **Vercel Production**. Nigdy nie
wklejaj go do `config.js`, kodu aplikacji ani GitHuba. Jest potrzebny wyłącznie
do usunięcia faktury przez bezpieczny endpoint po ponownej weryfikacji hasła
właściciela.

Po udanym wdrożeniu właściciel może tworzyć konta z aplikacji. Funkcja sama
sprawdza sesję i rolę właściciela; klucz `service_role` pozostaje po stronie
Supabase.

## KSeF — DEMO: test i import miesięczny

Zakładka **Faktury** najpierw wykonuje test uwierzytelnienia. Przycisk
**Importuj miesiąc DEMO** uruchamia `api/ksef-import.ts`: funkcja odczytuje
wszystkie metadane faktur sprzedażowych i zakupowych z wybranego miesiąca,
zapisuje nowe pozycje, automatycznie pomija duplikaty po numerze KSeF i może
od razu przypisać nową FV według reguł z zakładki **Faktury**. Import obejmuje maksymalnie 100 faktur każdego
rodzaju na jedno uruchomienie. Nie trzeba dodawać kolejnych sekretów — używa
tych samych zmiennych środowiskowych Vercel opisanych wyżej.

Podczas importu PrądPlan odczytuje termin płatności z XML faktury. Kolejny
import automatycznie uzupełnia ten termin także w wcześniej zapisanych
fakturach, które go nie miały — bez duplikowania dokumentów. Przycisk
**Podgląd** przy zaimportowanej fakturze pokazuje bezpieczną wizualizację
utworzoną z jej XML (KSeF nie udostępnia gotowego PDF-a podglądu). W przypadku
dokumentu z wieloma stawkami VAT rejestr zapisuje obliczoną stawkę efektywną.

Nie zapisuj NIP-u, certyfikatu, klucza ani hasła w `config.js` ani GitHubie.
Sekrety KSeF dodawaj wyłącznie jako zmienne **Secret** w Vercel.

## KSeF — PRODUKCJA: wyłącznie odczyt i import

PrądPlan nie wystawia i nie wysyła faktur do KSeF. Połączenie produkcyjne
może tylko: potwierdzić uwierzytelnienie, odczytać faktury zakupowe lub
sprzedażowe, pobrać ich XML do podglądu oraz zapisać ich metadane w rejestrze
PrądPlan.

1. Najpierw uruchom migrację
   `supabase/migrations/017_ksef_production_environment.sql` w Supabase SQL
   Editor. Rozdziela ona dokumenty DEMO i PRODUKCJI, dlatego ten sam numer
   KSeF nie zostanie pomylony między środowiskami. Blokuje też późniejszą
   zmianę numeru KSeF albo środowiska zaimportowanej faktury z przeglądarki.
2. W KSeF PRODUKCJA utwórz lub użyj ważnego certyfikatu przeznaczonego do
   **uwierzytelnienia**. Certyfikat DEMO nie działa na PRODUKCJI.
3. W **Vercel → projekt PrądPlan → Settings → Environment Variables** dodaj
   dla środowiska **Production** poniższe zmienne jako **Secret**:

   ```text
   KSEF_PROD_NIP
   KSEF_PROD_CERTIFICATE_BASE64
   KSEF_PROD_PRIVATE_KEY_BASE64
   KSEF_PROD_PRIVATE_KEY_PASSWORD
   ```

   Wartości certyfikatu i klucza są Base64, tak samo jak w konfiguracji DEMO.
   Nie wklejaj ich do czatu, repozytorium ani `config.js`.
4. Na tym etapie nie dodawaj zmiennej `KSEF_PROD_IMPORT_ENABLED` albo ustaw
   ją na `false`. Wdróż nową wersję aplikacji w Vercel.
5. Jako właściciel otwórz **Faktury**, przełącz środowisko na
   **PRODUKCJA** i kliknij **Test połączenia**. Test niczego nie pobiera,
   nie zapisuje i nie wysyła.
6. Dopiero po udanym teście dodaj w Vercel jako **Secret**:

   ```text
   KSEF_PROD_IMPORT_ENABLED=true
   ```

   Następnie wykonaj kolejny deploy, aby Vercel przekazał zmienną funkcjom
   serwerowym. Import z PRODUKCJI pozostaje dostępny tylko dla roli `owner`.
7. Na początek zaimportuj jeden zamknięty miesiąc i porównaj liczbę oraz
   wartości dokumentów z KSeF. Ponowny import pomija dokumenty o tym samym
   numerze KSeF **w tym samym środowisku**.

Certyfikat oraz klucz produkcyjny nigdy nie trafiają do przeglądarki: używają
ich wyłącznie endpointy Node.js w Vercel. Przycisk **Podgląd** również pobiera
XML wyłącznie przez serwer i jest dla faktur produkcyjnych dostępny tylko dla
właściciela.

## Płatności, budżet kontraktu i załączniki FV

Po uruchomieniu migracji `016_cashflow_budget_attachments.sql` dostępne są trzy
dodatkowe obszary:

- **Płatności i cash flow** — miesięczny kalendarz prognozowanych wpływów i
  wypływów brutto. Po potwierdzeniu przelewu użyj przycisku **Oznacz jako
  opłaconą**; pozycja znika z prognozy, a data opłacenia zapisuje się w bazie.
- **Budżet kontraktu według kategorii** — na karcie kontraktu ustaw plan netto
  dla materiałów, robocizny, podwykonawców, sprzętu i pozostałych kosztów.
  Przy rozliczaniu faktury zakupowej wybierz kategorię dla każdej części FV.
- **Skan i OCR dokumentu ręcznego** — podczas dodawania ręcznej FV lub paragonu
  z NIP można od razu wybrać prywatny PDF, JPG, PNG albo WEBP (do 15 MB).
  Skan zostanie zapisany i przekazany do kolejki OCR. Później jest dostępny w
  rejestrze przez przycisk **Skan / OCR**. Faktury pobrane z KSeF nie mają tego
  przycisku — ich podgląd jest pobierany bezpośrednio z KSeF.

Kolejka OCR nie odczytuje dokumentu samodzielnie — do automatycznego odczytu
potrzebny jest jeszcze wybrany przez firmę dostawca OCR i jego sekret API po
stronie serwera. Nie dodawaj takiego klucza do `config.js` ani do GitHuba.
