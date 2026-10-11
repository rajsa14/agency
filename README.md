# Agency

Virtuální kancelář AI agentů WebTix. Díváš se na ni shora, každý agent má svůj stůl, a přímo z webu mu zadáváš práci, sleduješ průběh a schvaluješ výsledky. Úkoly zpracovává skutečný model (Claude přes Anthropic API); nic se nepředstírá.

## Spuštění na počítači

```bash
npm install
```

```bash
node office.mjs
```

Pak otevři http://localhost:5190. Server je potřeba, protože kancelář není jen stránka: ukládá úkoly do databáze, volá AI a drží API klíč mimo prohlížeč. Samotné `public/index.html` otevřené jako soubor proto nefunguje.

Lokálně se nepřihlašuje (server poslouchá jen na tomto počítači) a data jsou v `work/agency.db`.

## Aby agenti opravdu pracovali

Vytvoř ve složce projektu soubor `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

a spusť kancelář znovu. Klíč zůstává na serveru, do prohlížeče se nikdy neposílá. Bez klíče máš dvě možnosti:

- **Vývojový režim** (Nastavení → AI poskytovatelé). Úkoly projdou celým postupem, ale výsledek je označený ukázkový text. Slouží k vyzkoušení, ne k práci.
- **Claude Code jako pracovník.** Úkol dej „Jen do fronty“ a v Claude Code řekni `run the agency`. Úkoly pak zpracují tvoji Claude Code agenti a výsledky se vrátí ke schválení. Funguje jen s lokální kanceláří.

## Jak se s kanceláří pracuje

- **Kancelář.** Tažením posouváš, kolečkem nebo tlačítky vpravo přibližuješ, pravým tlačítkem lehce otáčíš. Kliknutím na agenta (nebo v seznamu vlevo) otevřeš jeho profil a pohled se na něj přiblíží.
- **Zadání úkolu.** V profilu agenta napiš zadání, případně prioritu, termín, kontext, textové přílohy a na které úkoly navazuje. „Zadat a spustit“ ho pustí hned, „Jen do fronty“ počká na ruční spuštění.
- **Průběh a výsledek.** V detailu úkolu vidíš text, jak ho agent píše, všechny běhy (model, čas, tokeny) a historii změn. Úkol jde pozastavit, zrušit, zkusit znovu.
- **Schválení.** Hotový úkol čeká na tebe: schválíš ho, nebo ho s připomínkami vrátíš a agent ho přepracuje jako další verzi.
- **Chat s kanceláří.** Dole napíšeš celý požadavek. Manažer (CEO) ho rozdělí na úkoly pro jednotlivé agenty včetně návazností a ukáže ti plán. Teprve po schválení se úkoly rozdají. Navazující úkol se spustí, až schválíš ten předchozí, a dostane jeho výsledek.
- **Úkoly, Schválení, Historie, Nastavení** jsou v horní liště: nástěnka a seznam úkolů, fronta ke schválení, záznam všeho, co se stalo, a nastavení agentů a AI.

Stavy agentů (Volno, Přemýšlí, Pracuje, Čeká, Ke schválení, Dokončil, Chyba) se odvozují z jejich skutečných úkolů. Agent u stolu píše jen tehdy, když jeho úkol opravdu běží.

Úkoly spouští otevřená stránka kanceláře. Když ji zavřeš, rozběhnutý úkol se dokončí nebo po chvíli označí jako přerušený (dá se spustit znovu) a čekající úkoly počkají, až kancelář zase otevřeš.

## Pracovní doba

Kancelář pracuje 06:00–22:00 pražského času. Mimo tuto dobu všichni spí a server žádný úkol nespustí ani nerozplánuje; úkoly zadané v noci počkají na ráno. Hodiny jsou v `server/time.js`. Adresa s `?time=23:30` ukáže, jak kancelář vypadá v jinou hodinu (jen obraz, pravidla se řídí skutečným časem).

## Nasazení (Cloudflare Workers)

Web běží jako Worker `agency` a nasazuje se sám po pushi do `main`. Soubory z `public/` obsluhuje Cloudflare, vše pod `/api/` řeší `worker.js`, data jsou v databázi D1 (`wrangler.jsonc`; databázi `agency` si Wrangler při prvním nasazení vytvoří sám).

V Cloudflare (Workers → agency → Settings → Variables and Secrets) nastav dvě tajné proměnné:

| Proměnná | K čemu |
|---|---|
| `ADMIN_PASSWORD` | Heslo do kanceláře. Bez něj je web jen k nahlédnutí a nic nejde zadat. |
| `ANTHROPIC_API_KEY` | Klíč, se kterým agenti pracují. Bez něj se žádný úkol nespustí. |

Volitelně `SESSION_SECRET` (jinak se podpis přihlášení odvozuje z hesla). Build nastavení ve Workers Builds: deploy command `npx wrangler deploy`, build command žádný.

Lokální zkouška produkční varianty:

```bash
npx wrangler dev
```

(heslo pro ni dej do souboru `.dev.vars` jako `ADMIN_PASSWORD=...`).

## Jak je to postavené

| Soubor | Co dělá |
|---|---|
| `office.mjs` | Lokální server (Node) a příkazy `build`, `sync`, `queue`, `next`, `done`, `fail` |
| `worker.js`, `wrangler.jsonc` | Vstup a konfigurace pro Cloudflare |
| `server/app.js` | Celé API: agenti, úkoly, běhy, schvalování, plány manažera, historie |
| `server/ai.js` | AI poskytovatelé: Anthropic (oficiální SDK, streamování, hledání na webu) a vývojový režim |
| `server/db.js` | Tabulky a migrace; stejný SQL běží na D1 i na lokálním SQLite |
| `server/auth.js`, `server/time.js` | Přihlášení heslem, pracovní doba |
| `server/seed.js` | Agenti, se kterými začíná nová databáze (generuje se z `agents/*.md`) |
| `public/js/scene.js`, `characters.js` | Izometrická kancelář ve WebGL (three.js z CDN), nábytek, chůze a chování postav |
| `public/js/store.js` | Stav stránky, volání API, spouštění úkolů |
| `public/js/panels.js`, `views.js`, `chat.js` | Profil agenta a detail úkolu, nástěnka a další přehledy, chat |

## Agenti

Nová databáze začíná s agenty z `agents/*.md`. Dál je spravuješ v kanceláři (Nastavení → Agenti): role, oddělení, odpovědnost, systémové instrukce, model, hledání na webu, vzhled. „Přidat agenta“ přijme nového. Agent, který má svůj soubor v `agents/`, se při úpravě v lokální kanceláři do souboru zapíše a nainstaluje se i do Claude Code.

| Příkaz | Co dělá |
|---|---|
| `node office.mjs build` | Přegeneruje `server/seed.js` ze souborů v `agents/` |
| `node office.mjs sync` | Nainstaluje agenty a skill `run-agency` do `~/.claude` |

Agenti mají ve webové kanceláři jediný skutečný nástroj: hledání na webu (dá se u každého vypnout). K souborům, prohlížeči ani odesílání zpráv přístup nemají, takže cokoli napíšou, je návrh, který schvaluješ ty.
