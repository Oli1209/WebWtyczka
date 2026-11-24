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
5. Stuknij **Ustawienia**, wybierz tryb działania (Safari iOS albo Firefox
   Android), potem providera i wklej klucze, po jednym w wierszu, np.
   - Gemini: https://aistudio.google.com/apikey
   - OpenRouter: https://openrouter.ai/keys
   - Groq: https://console.groq.com/keys
   Model zostaw na `auto`.
6. **Zapisz**.

Aktualizacja: po zmianie pliku na GitHubie otwórz ten sam link raw i
zainstaluj nowszą wersję (Userscripts podmieni skrypt). Numer wersji widać
w nagłówku panelu, obok napisu **Tab Tools** (np. `v2.3.0`).

## Jak używać

- **Zaznaczenie** — zaznacz tekst pytania, potem stuknij **TT**. Jeśli iOS
  odznaczy tekst przy pierwszym stuknięciu (tak potrafi zrobić), stuknij
  **TT** drugi raz: wybrane fragmenty są już zapamiętane. Skrót zaznaczenia i
  jego długość widać w panelu nad przyciskami (np. „Pytanie 4 ... · 182
  znaków”), a krzyżyk obok niego czyści pamięć i zaznaczenie na stronie.
  Pamiętane zaznaczenie trzyma się 2 minuty.
- **Dwukrotne stuknięcie w TT** — szybka odpowiedź bez panelu: zaznacz
  tekst i stuknij **TT** dwa razy (w ciągu ok. 0,4 s). Zaznaczenie od razu
  leci do modelu, a odpowiedź pojawia się w małym ciemnym dymku nad
  przyciskiem. Jedno stuknięcie nadal otwiera i zamyka panel, tylko z krótkim
  opóźnieniem, żeby odróżnić je od dwukrotnego.
- **Przytrzymanie TT przez 2 sekundy bez ruchu** — tryb cichy: bez panelu i
  bez dymka „Analizuję…”. Skrypt czyta pierwsze widoczne, nierozwiązane
  zadanie ze strony i wysyła sam tekst, więc nie wyskakuje żadne okno
  udostępniania ekranu. Zrzut ekranu robi tylko wtedy, gdy tekstu brakuje
  albo jest za krótki (np. pytanie jest obrazkiem). Krótka odpowiedź
  (litera, 1-2 słowa, krótka lista) pojawia się w dymku mniejszą czcionką.
  Dłuższa odpowiedź otwarta trafia do schowka, a dymek mówi **Gotowe**.
  Jeśli system nie pozwoli zapisać do schowka, dymek ma przycisk
  **Skopiuj**.
- **Tekst strony** — wysyła tekst widoczny na stronie (do 12000 znaków).
- **Zdjęcie** — wybierz zdjęcie z biblioteki albo zrób nowe; do promptu
  doklejany jest też tekst strony, żeby model lepiej odczytał treść.
- **Typy zadań** — pojedynczy wybór, wielokrotny, prawda/fałsz, liczbowy,
  otwarty, łączenie par, uzupełnianie luk, układanie w kolejności i tabela
  Prawda/Fałsz. Odpowiedź otwarta to jedno krótkie zdanie, prostymi słowami,
  bez listy i myślników. Skrypt nigdy nie wpisuje odpowiedzi na stronę i nie
  wysyła formularza.
- **Motyw** — w nagłówku panelu, obok krzyżyka, jest księżyc/słońce:
jedno stuknięcie przełącza panel i przycisk na jasny albo ciemny. Wybór
zostaje zapamiętany. Bez zapisanego wyboru skrypt bierze motyw systemowy.
- **Przesuwanie przycisku** — przytrzymaj **TT** około 0,4 s i rusz palcem;
  kółko powiększy się i dostanie niebieską obwódkę, gdy zaczniesz przeciągać.
  Trzymanie bez ruchu przez 2 s uruchamia tryb cichy, więc przeciąganie wymaga
  ruchu. Pozycja zapisuje się i wraca po odświeżeniu strony oraz po obrocie
  telefonu (zawsze w granicach ekranu).

Panel jest jasny i półprzezroczysty, a przycisk **TT** jest mały i przygaszony,
żeby nie zasłaniał strony. Rozjaśnia się, gdy otworzysz panel albo gdy jest
zapamiętane zaznaczenie gotowe do wysłania (delikatna niebieska obwódka).
Puknięcie poza panelem zamyka go.

Dymek szybkiej odpowiedzi trzyma się przy przycisku, więc po przeciągnięciu
**TT** w inne miejsce nadal pojawia się obok niego i nie wychodzi za ekran.
W trybie ciemnym dymek jest jasny, żeby odpowiedź była czytelna.

Odpowiedź pojawia się w panelu pod przyciskami. Przy pewności poniżej 40%
panel dopisuje ostrzeżenie. Długa odpowiedź otwarta w trybie szybkim i cichym
nie jest pokazywana w całości: dymek mówi **Gotowe**, a tekst ląduje w
schowku.

## Różnice względem wersji Chrome

- Safari na iOS od wersji 27 ma `getDisplayMedia`, ale przy każdym zrzucie
  pokazuje systemowe okno wyboru ekranu, a jego potwierdzenie potrafi wejść
  do pierwszych klatek. Dlatego tryb cichy najpierw korzysta z tekstu strony,
  a zrzut robi tylko wtedy, gdy tekst nie wystarcza. Zrzut czeka wtedy na
  stabilny obraz (dwie identyczne próbki), odrzuca klatki puste i przycina
  paski systemowe u góry i dołu, więc do modelu nie trafia okno potwierdzenia.
  Bez HTTPS albo przy odmowie dostępu zostaje tekst strony.
- **Tryb działania** w ustawieniach wybiera zachowanie pod Safari iOS albo
  Firefox Android (Tampermonkey). Różnice są niewielkie: iOS kopiuje przez
  `execCommand` w geście stuknięcia (jego `navigator.clipboard` bywa
  odrzucany), Android kopiuje przez Clipboard API i wibruje przy
  przeciąganiu. Przycisk na Androidzie jest trochę większy.
- Nie ma skrótów klawiszowych. Pierwsze widoczne zadanie skrypt wyłapuje
  tylko po 2 s przytrzymania **TT**.
- Dotknięcie czegokolwiek poza stroną odznacza tekst w Safari, dlatego
  zaznaczenie jest przechwytywane przy `selectionchange` i trzymane w pamięci
  przez 2 minuty. Dzięki temu kolejność „zaznacz, potem otwórz panel” działa.
- Przycisk ma `touch-action:none`, żeby przytrzymanie i przeciąganie działało
  pewnie. Przesunięcie palcem rozpoczęte na samym kółku nie przewija strony —
  do przewijania użyj resztę ekranu.
- Skrypt czyta tylko tekst strony głównej. Treść w obcych iframe'ach
  (np. osadzone testy) może być niewidoczna — wtedy użyj zdjęcia.
- Klucze są trzymane w magazynie userscriptu (`GM.setValue`), a gdy go nie ma,
  w `localStorage`. Nie trafiają do kodu strony. Motyw i pozycja przycisku leżą
  w osobnym wpisie (`tt_ios_ui`), razem z kluczami tylko w tym samym magazynie.

## Gdy coś nie działa

- **Brak przycisku TT**: Userscripts nie ma dostępu do tej strony. Sprawdź
  ustawienia rozszerzenia dla danej witryny i odśwież stronę.
- **Brak klucza ...**: klucz nie został zapisany dla wybranego providera.
  Otwórz Ustawienia i zapisz ponownie.
- **Limit zapytań (429)**: darmowe plany mają limit na minutę. Skrypt sam
  przeskakuje na następny klucz z listy, a przy braku kolejnego na innego
  providera. Klucz w limicie odpoczywa 10 minut, odrzucony 60 minut.
- **Model nie zwrócił treści**: model nie odczytał pytania. Spróbuj ze
  zdjęciem wyraźniejszym, krótszym zaznaczeniem albo innym providerem.
- **Pierwsze stuknięcie tylko odznacza tekst**: tak działa iOS przy aktywnym
  zaznaczeniu. Stuknij **TT** ponownie, zaznaczenie jest już zapamiętane.
- **Przycisk TT nie przeszkadza**: jest przygaszony, dopóki nie jest potrzebny.
  Gdy panel jest otwarty, zamyka go stuknięcie w dowolne miejsce strony.

## Kilka kluczy API

W ustawieniach jednego providera można trzymać do 8 kluczy, po jednym w
wierszu. Pierwszy wiersz ma priorytet. Gdy klucz zwróci limit (429), brak
środków (402) albo zostanie odrzucony (401/403), skrypt bierze następny, a
klucz z limitem wpada na 10 minut karencji (odrzucony na 60). Klucz, który
zadziałał, wraca na początek listy, więc priorytet idzie za tym, co naprawdę
działa, i zostaje zapisany. Zapis nowej listy kluczy czyści stare karencje.

## Uwaga o kluczach

Klucze API są widoczne dla skryptu działającego na stronie, więc nie
wpisuj ich na współdzielonym telefonie. Wersja Chrome trzyma klucze poza
stroną (w rozszerzeniu), userscript nie ma takiego luksusu.
