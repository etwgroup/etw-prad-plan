# Import KSeF

`index.ts` jest serwerową bramką uruchamianą z zakładki **Faktury**. Weryfikuje
sesję oraz rolę `owner`/`accountant`, zapisuje próbę importu do
`invoice_import_runs` i sprawdza, czy tajne dane połączenia są skonfigurowane.

Nie umieszczaj tokenu, certyfikatu ani klucza KSeF w `config.js`, GitHubie lub
kodzie przeglądarkowym. Ustaw je wyłącznie jako Supabase Edge Function Secrets.

Przed użyciem produkcyjnym należy uzupełnić adapter aktualnej wersji API KSeF w
`index.ts`, obejmujący autoryzację, pobranie faktur, walidację pól oraz
deduplikację po `ksef_number`. Najpierw wykonaj test w środowisku testowym KSeF.
