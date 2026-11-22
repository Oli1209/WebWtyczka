# Tab Tools na iPhone (userscript)

Wersja rozszerzenia dla Safari na iOS. Działa jako userscript w aplikacji
**Userscripts** i daje przycisk **TT** w rogu strony: zaznaczenie, tekst strony
albo zdjęcie zadania, jedno pytanie do modelu i odpowiedź w panelu.

## Instalacja z GitHuba

1. Wrzuć ten folder do publicznego repozytorium, np. tak:

   ```
   twoj-login/tab-tools/
     safari/tab-tools.user.js
     safari/README.md
   ```

2. Zezwól Safari na rozszerzenia:
   - zainstaluj z App Store **Userscripts**,
   - Ustawienia -> Safari -> Rozszerzenia -> Userscripts: włącz i daj dostęp
     do wszystkich stron.
3. Na telefonie otwórz w Safari plik z GitHuba. Najprościej link **raw**:

   ```
   https://raw.githubusercontent.com/twoj-login/tab-tools/main/safari/tab-tools.user.js
   ```

   Otwórz go jako zwykłą stronę (nie przez aplikację GitHub). Userscripts
   wykryje plik `.user.js` i pokaże przycisk **Install** / **Zainstaluj**.
4. Wejdź na dowolną stronę, odśwież ją i stuknij niebieski przycisk **TT**.
5. Stuknij **Ustawienia**, wybierz providera i wklej klucz, np.
   - Gemini: https://aistudio.google.com/apikey
   - OpenRouter: https://openrouter.ai/keys
   - Groq: https://console.groq.com/keys
   Model zostaw na `auto`.
6. **Zapisz**.

Aktualizacja: po zmianie pliku na GitHubie otwórz ten sam link raw i
zainstaluj nowszą wersję (Userscripts podmieni skrypt).

## Jak używać

- **Zaznaczenie** — najpierw zaznacz tekst pytania na stronie, potem stuknij.
- **Tekst strony** — wysyła tekst widoczny na stronie (do 12000 znaków).
- **Zdjęcie** — wybierz zdjęcie z biblioteki albo zrób nowe; do promptu
  doklejany jest też tekst strony, żeby model lepiej odczytał treść.

Odpowiedź pojawia się w panelu pod przyciskami. Przy pewności poniżej 40%
panel dopisuje ostrzeżenie.

## Różnice względem wersji Chrome

- Safari na iOS nie pozwala zrobić zrzutu ekranu karty, więc zamiast
  automatycznego zrzutu jest zdjęcie z biblioteki lub aparatu.
- Nie ma skrótów klawiszowych ani automatycznego wyłapywania pytań: wszystko
  uruchamia się stuknięciem w **TT**.
- Skrypt czyta tylko tekst strony głównej. Treść w obcych iframe'ach
  (np. osadzone testy) może być niewidoczna — wtedy użyj zdjęcia.
- Klucze są trzymane w magazynie userscriptu (`GM.setValue`), a gdy go nie ma,
  w `localStorage`. Nie trafiają do kodu strony.

## Gdy coś nie działa

- **Brak przycisku TT**: Userscripts nie ma dostępu do tej strony. Sprawdź
  ustawienia rozszerzenia dla danej witryny i odśwież stronę.
- **Brak klucza ...**: klucz nie został zapisany dla wybranego providera.
  Otwórz Ustawienia i zapisz ponownie.
- **Limit zapytań (429)**: darmowe plany mają limit na minutę. Odczekaj
  chwilę albo przełącz providera.
- **Model nie zwrócił treści**: model nie odczytał pytania. Spróbuj ze
  zdjęciem wyraźniejszym, krótszym zaznaczeniem albo innym providerem.

## Uwaga o kluczach

Klucz API jest widoczny dla skryptu działającego na stronie, więc nie
wpisuj go na współdzielonym telefonie. Wersja Chrome trzyma klucze poza
stroną (w rozszerzeniu), userscript nie ma takiego luksusu.
