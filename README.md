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
├── config.js                          jedyne miejsce na publiczną konfigurację
└── supabase/
    ├── migrations/
    │   ├── 001_initial_schema.sql     tabele, role i RLS
    │   ├── 002_audit_log.sql          historia zmian
    │   ├── 003_invoice_import.sql     przygotowanie importu KSeF
    │   ├── 004_authenticated_grants.sql uprawnienia do odczytu i zapisu przez API
    │   ├── 005_contract_operations.sql karta kontraktu, akceptacje i dokumenty
    │   └── 006_contract_storage.sql   prywatny magazyn dokumentów
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

Każdy plik wklej jako osobne zapytanie i wybierz **Run**. Nie uruchamiaj tych
migracji w istniejącym projekcie z inną strukturą bez wcześniejszej kopii bazy.

Migracja `001` tworzy: kontrakty, rozliczenia, faktury, koszty firmowe,
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

Po udanym wdrożeniu właściciel może tworzyć konta z aplikacji. Funkcja sama
sprawdza sesję i rolę właściciela; klucz `service_role` pozostaje po stronie
Supabase.

## KSeF — bezpieczny etap integracyjny

Przycisk **Sprawdź połączenie** uruchamia funkcję `import-ksef`, która zapisuje
historię próby importu po stronie serwera. Nie zapisuj tokenu ani certyfikatu
KSeF w `config.js`, GitHubie lub Vercel. Po uzyskaniu właściwego dostępu KSeF
ustaw w Supabase Secrets `KSEF_API_URL` i `KSEF_ACCESS_TOKEN` (lub wdrożony
mechanizm certyfikatu), a następnie dodaj adapter aktualnej wersji API do
`supabase/functions/import-ksef/index.ts`. Dopiero adapter pobiera i mapuje
faktury oraz chroni przed duplikacją po numerze KSeF.
