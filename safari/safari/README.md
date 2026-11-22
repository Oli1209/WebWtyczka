# Tab Tools na iPhone (userscript)

Wersja rozszerzenia dla Safari na iOS. Działa jako userscript w aplikacji
**Userscripts** i daje mały, półprzezroczysty przycisk **TT** w rogu strony:
zaznaczenie, tekst strony albo zdjęcie zadania, jedno pytanie do modelu i
odpowiedź w jasnym panelu.

Wybrany fragment nie przepada po stuknięciu w przycisk. Skrypt zapamiętuje go
w chwili zaznaczania, więc panel można otworzyć dopiero po nim, a tekst nadal
zostanie wysłany.

## Instalacja z GitHuba

1. Wrzuć ten folder do publicznego repozytorium, np. tak:

   ```
   Oli1209/WebWtyczka/
     safari/safari/tab-tools.user.js
     safari/safari/README.md
   ```

2. Zezwól Safari na rozszerzenia:
   - zainstaluj z App Store **Userscripts**,
   - Ustawienia -> Safari -> Rozszerzenia -> Userscripts: włącz i daj dostęp
     do wszystkich stron.
3. Na telefonie otwórz w Safari plik z GitHuba. Najprościej link **raw**:

   ```
   https://raw.githubusercontent.com/Oli1209/WebWtyczka/main/safari/safari/tab-tools.user.js
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
zainstaluj nowszą wersję (Userscripts podmieni skrypt). Numer wersji widać
w nagłówku panelu, obok napisu **Tab Tools** (np. `v2.0.1`).

## Jak używać

- **Zaznaczenie** — zaznacz tekst pytania, potem stuknij **TT**. Jeśli iOS
  odznaczy tekst przy pierwszym stuknięciu (tak potrafi zrobić), stuknij
  **TT** drugi raz: wybrane fragmenty są już zapamiętane. Skrót zaznaczenia i
  jego długość widać w panelu nad przyciskami (np. „Pytanie 4 ... · 182
  znaków”), a krzyżyk obok niego czyści pamięć i zaznaczenie na stronie.
  Pamiętane zaznaczenie trzyma się 2 minuty.
- **Tekst strony** — wysyła tekst widoczny na stronie (do 12000 znaków).
- **Zdjęcie** — wybierz zdjęcie z biblioteki albo zrób nowe; do promptu
  doklejany jest też tekst strony, żeby model lepiej odczytał treść.

Panel jest jasny i półprzezroczysty, a przycisk **TT** jest mały i przygaszony,
żeby nie zasłaniał strony. Rozjaśnia się, gdy otworzysz panel albo gdy jest
zapamiętane zaznaczenie gotowe do wysłania (delikatna niebieska obwódka).
Puknięcie poza panelem zamyka go.

Odpowiedź pojawia się w panelu pod przyciskami. Przy pewności poniżej 40%
panel dopisuje ostrzeżenie.

## Różnice względem wersji Chrome

- Safari na iOS nie pozwala zrobić zrzutu ekranu karty, więc zamiast
  automatycznego zrzutu jest zdjęcie z biblioteki lub aparatu.
- Nie ma skrótów klawiszowych ani automatycznego wyłapywania pytań: wszystko
  uruchamia się stuknięciem w **TT**.
- Dotknięcie czegokolwiek poza stroną odznacza tekst w Safari, dlatego
  zaznaczenie jest przechwytywane przy `selectionchange` i trzymane w pamięci
  przez 2 minuty. Dzięki temu kolejność „zaznacz, potem otwórz panel” działa.
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
- **Pierwsze stuknięcie tylko odznacza tekst**: tak działa iOS przy aktywnym
  zaznaczeniu. Stuknij **TT** ponownie, zaznaczenie jest już zapamiętane.
- **Przycisk TT nie przeszkadza**: jest przygaszony, dopóki nie jest potrzebny.
  Gdy panel jest otwarty, zamyka go stuknięcie w dowolne miejsce strony.

## Uwaga o kluczach

Klucz API jest widoczny dla skryptu działającego na stronie, więc nie
wpisuj go na współdzielonym telefonie. Wersja Chrome trzyma klucze poza
stroną (w rozszerzeniu), userscript nie ma takiego luksusu.
