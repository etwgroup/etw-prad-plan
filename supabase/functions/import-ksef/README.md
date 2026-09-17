# Import KSeF — etap 2

Ten katalog jest celowo pusty w pierwszym wdrożeniu. Aplikacja oraz baza są
gotowe na import KSeF, ale połączenie z produkcyjnym KSeF wymaga osobnego,
bezpiecznego wdrożenia Edge Function i sekretów po stronie Supabase.

Nie umieszczaj tokenu, certyfikatu ani klucza KSeF w `config.js`, GitHubie lub
kodzie przeglądarkowym. Import należy uruchamiać wyłącznie z Edge Function
z kluczem `service_role` zapisanym jako sekret środowiska.
