# PrądPlan — funkcje Supabase Edge Functions

Ten folder zawiera funkcje wykonywane wyłącznie po stronie Supabase:

- `admin-users` — właściciel tworzy konto pracownika z poziomu PrądPlan;
- `import-ksef` — bezpiecznie inicjuje i rejestruje import KSeF.

Wdrażaj je do projektu Supabase, nie do Vercel:

```bash
supabase login
supabase link --project-ref TWOJ_PROJECT_REF
supabase functions deploy admin-users
supabase functions deploy import-ksef
```

Domyślne zmienne środowiskowe Supabase dla funkcji obejmują adres projektu oraz
klucze serwerowe. Nie przenoś ich do aplikacji przeglądarkowej. Dane KSeF
ustawiaj tylko w **Edge Functions → Secrets** lub przez CLI, np.:

```bash
supabase secrets set KSEF_API_URL=https://adres-zatwierdzonego-api
supabase secrets set KSEF_ACCESS_TOKEN=wartosc-trzymana-poza-repozytorium
```

Samo ustawienie sekretów nie jest jeszcze importerem faktur. Adapter aktualnej
wersji KSeF, mapowanie dokumentów i deduplikacja muszą zostać zatwierdzone po
wyborze firmowego sposobu autoryzacji oraz przetestowane najpierw w środowisku
testowym KSeF.
