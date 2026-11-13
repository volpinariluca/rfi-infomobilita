# 🚆 RFI Infomobilità Hub

Web app leggera e veloce (zero dipendenze esterne) per consultare, cercare e classificare in comodità i feed RSS ufficiali **Infomobilità di RFI** (`Aggiornamenti Live` e `Avvisi Programmati`), preconfigurata per l'**Emilia-Romagna** e compatibile con tutte le regioni italiane.

Progettata per girare con consumi minimi (~25 MB di RAM) su **home-server S21** (Linux / Termux).

---

## ✨ Funzionalità principali

- **Aggregazione Live + Avvisi**: unisce in tempo reale i feed `infomobilita.rss.updates.emilia_romagna.xml` e `infomobilita.rss.notices.emilia_romagna.xml` (con selettore per cambiare regione o passare al feed nazionale).
- **Classificazione automatica e colori**:
  - 🔴 **Circolazione Sospesa / Scioperi**
  - 🟠 **Rallentamenti / Ritardi** (con estrazione automatica dei minuti di ritardo e della causa)
  - 🟢 **Tornata Regolare**
  - 🔵 **Avvisi / Lavori Programmati**
  - Badge per categoria treno: **Frecce / AV**, **Intercity**, **Regionali**.
- **Finder istantaneo**: ricerca multi-termine con evidenziazione (scorciatoia `/`), filtri combinabili per stato, tipo di feed, categoria treno e nodi rapidi (`Bologna`, `Modena`, `Reggio Emilia`, `Parma`, `Rimini`, `Milano`, `Firenze`, `Roma`, ecc.).
- **Le mie tratte (Watchlist)**: salva le tue stazioni o linee preferite in `localStorage` per evidenziarle e filtrarle con un clic.
- **Dettaglio completo integrato**: cliccando su qualsiasi scheda si apre un pannello laterale che scarica e formatta automaticamente il testo completo dell'avviso da `rfi.it` (inclusa cronologia, tabelle treni/bus sostitutivi e link ai PDF).
- **Comfort**: tema Chiaro/Scuro, auto-refresh ogni 3 minuti con countdown, tracking letti/non letti, notifiche browser opzionali e supporto PWA (*Aggiungi a schermata Home*).

---

## 🚀 Avvio rapido su Home-Server S21

Non serve `npm install` (zero dipendenze esterne, solo Node.js >= 18).

```bash
git clone https://github.com/volpinariluca/rfi-infomobilita.git
cd rfi-infomobilita
npm start
```

L'app sarà accessibile sulla rete locale all'indirizzo `http://<IP-DEL-TUO-S21>:3080`.

Per cambiare porta:

```bash
PORT=8085 npm start
```

Per tenerla attiva in background con `pm2` o `tmux`:

```bash
pm2 start server.js --name rfi-infomobilita
```

---

## 🧪 Test

```bash
npm test
```

## 🔧 Variabili d'ambiente

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3080` | Porta HTTP del server |
| `HOST` | `0.0.0.0` | Indirizzo di ascolto |
| `CACHE_TTL_MS` | `180000` | Durata cache feed RSS in ms (3 minuti) |
| `ARTICLE_CACHE_TTL_MS` | `600000` | Durata cache pagine di dettaglio in ms (10 minuti) |
