const VT_BASE = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const VT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const VT_TIMEOUT_MS = 8000;

export function getRomeDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function getRomeMinutesOfDay(ms) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return h * 60 + m;
}

export function parseTimeToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isWithinTimeBand(ms, fasciaOraria) {
  if (!fasciaOraria || (!fasciaOraria.inizio && !fasciaOraria.fine)) return true;
  if (!ms) return true;
  const mins = getRomeMinutesOfDay(ms);
  const start = parseTimeToMinutes(fasciaOraria.inizio) ?? 0;
  const end = parseTimeToMinutes(fasciaOraria.fine) ?? 24 * 60;
  if (start <= end) {
    return mins >= start && mins <= end;
  }
  // Overnight band (e.g. 22:00 - 05:00)
  return mins >= start || mins <= end;
}

export function normalizeTrainCategory(rawCat = '', trainNumber = '') {
  const c = String(rawCat || '').trim().toUpperCase();
  if (c === 'FR' || c === 'FA' || c === 'FB' || c === 'AV' || c.includes('FRECCIA')) return 'FR';
  if (c === 'IC' || c === 'ICN' || c === 'EC' || c === 'EN') return 'IC';
  if (c === 'RV') return 'RV';
  if (c === 'REG' || c === 'R' || c === 'MET' || c === 'SFM') return 'REG';

  // Heuristic for Viaggiatreno responses where Frecciarossa/IC leave categoria empty
  const num = Number(trainNumber);
  if (!Number.isNaN(num)) {
    if ((num >= 8300 && num <= 8999) || (num >= 9300 && num <= 9999)) return 'FR';
    if (num >= 500 && num <= 799) return 'IC';
  }
  return c || 'REG';
}

export function formatViaggiatrenoDateString(date = new Date()) {
  // Format required by /partenze and /arrivi: "Fri Nov 13 2026 14:00:00 GMT+0100"
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset'
  }).formatToParts(date);

  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  const tzRaw = get('timeZoneName'); // e.g. "GMT+1" or "GMT+01:00"
  const tzMatch = tzRaw.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const offset = tzMatch
    ? `GMT${tzMatch[1]}${tzMatch[2].padStart(2, '0')}${tzMatch[3] || '00'}`
    : 'GMT+0100';

  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('weekday')} ${get('month')} ${get('day')} ${get('year')} ${hour}:${get('minute')}:${get('second')} ${offset}`;
}

export function stripStationPrefix(code) {
  // Converts S05043 -> 5043 (used by soluzioniViaggioNew)
  return String(code || '').replace(/^S0*/i, '');
}

export function parseStationAutocomplete(text, queryName) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.includes('|'));
  if (lines.length === 0) return null;

  const target = String(queryName || '').trim().toUpperCase();
  const parsed = lines.map((line) => {
    const [name, code] = line.split('|').map((s) => s.trim());
    return { name, code };
  });

  const exact = parsed.find((s) => s.name.toUpperCase() === target);
  if (exact) return exact;

  const starts = parsed.find((s) => s.name.toUpperCase().startsWith(target));
  return starts || parsed[0];
}

export function parseTrainAutocomplete(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.includes('|'));
  if (lines.length === 0) return null;

  // Format: "{numero} - {STAZIONE}|{numero}-{codice_origine}-{timestamp_partenza}"
  const [, payload] = lines[0].split('|');
  if (!payload) return null;
  const parts = payload.trim().split('-');
  if (parts.length < 3) return null;

  return {
    numeroTreno: String(parts[0]).trim(),
    codiceOrigine: String(parts[1]).trim(),
    timestampPartenza: Number(parts[2])
  };
}

export function isTrainInActiveWindow(train, nowMs = Date.now()) {
  const dep = Number(train.orarioPartenza || train.timestampPartenza || 0);
  if (!dep) return false;
  const arr = Number(train.orarioArrivo || dep + 240 * 60_000);
  const windowStart = dep - 15 * 60_000;
  const windowEnd = arr + 60 * 60_000;
  return nowMs >= windowStart && nowMs <= windowEnd;
}

export function evaluateAlertTransition(prevState, status, sogliaRitardo = 10) {
  const tipo = String(status.tipoTreno || '').toUpperCase();
  const prov = Number(status.provvedimento || 0);
  const ritardo = Number(status.ritardo ?? 0);

  const isSuppressed = tipo === 'ST' || tipo === 'PP' || prov !== 0;
  const isDeviated = tipo === 'DV';

  const prevSuppressed = Boolean(prevState?.suppressed);
  const prevDeviated = Boolean(prevState?.deviated);
  const lastAlertedDelay = prevState?.lastAlertedDelay ?? null;

  let alertReason = null;
  let severity = 'delayed';

  if (isSuppressed && !prevSuppressed) {
    alertReason = tipo === 'PP' ? 'Soppressione parziale' : 'Treno soppresso';
    severity = 'suspended';
  } else if (isDeviated && !prevDeviated) {
    alertReason = 'Deviazione di percorso';
    severity = 'delayed';
  } else if (!isSuppressed && ritardo >= sogliaRitardo) {
    if (lastAlertedDelay === null || ritardo - lastAlertedDelay >= 5) {
      alertReason = `Ritardo di +${ritardo} min`;
      severity = ritardo >= Math.max(30, sogliaRitardo * 2) ? 'suspended' : 'delayed';
    }
  }

  const nextState = {
    suppressed: isSuppressed,
    deviated: isDeviated,
    lastAlertedDelay:
      alertReason && !isSuppressed && !isDeviated ? ritardo : lastAlertedDelay,
    updatedAt: Date.now()
  };

  return {
    shouldAlert: Boolean(alertReason),
    alertReason,
    severity,
    nextState
  };
}

export function createViaggiatrenoService({ store, fetchImpl = fetch, onAlert = null }) {
  let pollTimer = null;
  let isPolling = false;
  const liveStatuses = new Map(); // key: `${numeroTreno}` -> latest andamentoTreno summary

  async function vtFetchText(endpoint) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VT_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${VT_BASE}${endpoint}`, {
        signal: controller.signal,
        headers: {
          'User-Agent': VT_USER_AGENT,
          Accept: 'application/json, text/plain, */*'
        }
      });
      if (!res.ok) {
        return null;
      }
      const text = await res.text();
      if (!text || text.trim() === '' || text.trim() === 'Error') {
        return null;
      }
      return text;
    } catch {
      // Silently handle timeouts / network errors (e.g. nightly maintenance window)
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function vtFetchJson(endpoint) {
    const text = await vtFetchText(endpoint);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function resolveStation(nomeStazione) {
    const clean = String(nomeStazione || '').trim();
    if (!clean) return null;
    const key = clean.toUpperCase();
    const state = store.getState();

    if (state.stations[key]) {
      return state.stations[key];
    }

    const text = await vtFetchText(`/autocompletaStazione/${encodeURIComponent(clean)}`);
    const parsed = parseStationAutocomplete(text, clean);
    if (parsed) {
      state.stations[key] = { ...parsed, updatedAt: Date.now() };
      store.scheduleSave();
    }
    return parsed;
  }

  async function resolveTrainOrigin(numeroTreno) {
    const text = await vtFetchText(`/cercaNumeroTrenoTrenoAutocomplete/${encodeURIComponent(numeroTreno)}`);
    return parseTrainAutocomplete(text);
  }

  async function discoverTrainsForRoute(route, now = new Date()) {
    const orig = await resolveStation(route.origine);
    const dest = await resolveStation(route.destinazione);
    if (!orig || !dest) {
      console.warn(`⚠️ Viaggiatreno: impossibile risolvere stazioni per tratta ${route.origine} -> ${route.destinazione}`);
      return [];
    }

    const candidates = new Map(); // numeroTreno -> metadata

    // 1. Primary endpoint: /soluzioniViaggioNew/{id_origine}/{id_destinazione}/{timestamp_ISO}
    const isoTs = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
    const solData = await vtFetchJson(
      `/soluzioniViaggioNew/${stripStationPrefix(orig.code)}/${stripStationPrefix(dest.code)}/${isoTs}`
    );

    if (solData && Array.isArray(solData.soluzioni)) {
      for (const sol of solData.soluzioni) {
        const vehicles = Array.isArray(sol.vehicles) ? sol.vehicles : [];
        if (vehicles.length !== 1) continue; // Only direct trains
        const v = vehicles[0];
        const num = String(v.numeroTreno || '').trim();
        if (!num) continue;

        const depMs = v.orarioPartenza ? new Date(v.orarioPartenza).getTime() : 0;
        const arrMs = v.orarioArrivo ? new Date(v.orarioArrivo).getTime() : 0;
        const auto = await resolveTrainOrigin(num);

        candidates.set(num, {
          numeroTreno: num,
          codiceOrigine: auto?.codiceOrigine || orig.code,
          timestampPartenza: auto?.timestampPartenza || depMs,
          categoria: normalizeTrainCategory(v.categoriaDescrizione || v.categoria, num),
          origineTreno: v.origine || orig.name,
          destinazioneTreno: v.destinazione || dest.name,
          orarioPartenza: depMs || auto?.timestampPartenza || 0,
          orarioArrivo: arrMs || 0
        });
      }
    }

    // 2. Resilient fallback via /partenze + /arrivi when soluzioniViaggioNew is unavailable (404)
    // Query shifted slots (+0h, +2h, +4h for departures; +1h, +2h, +3h, +5h for arrivals)
    // so passing Tper regional trains arriving 1-3h after departure are always matched.
    if (candidates.size === 0) {
      const depOffsetsH = [0, 2, 4, 6];
      const arrOffsetsH = [0, 1, 2, 3, 5, 7];

      const depCalls = depOffsetsH.map((h) => {
        const d = new Date(now.getTime() + h * 3_600_000);
        return vtFetchJson(`/partenze/${orig.code}/${encodeURIComponent(formatViaggiatrenoDateString(d))}`);
      });
      const arrCalls = arrOffsetsH.map((h) => {
        const d = new Date(now.getTime() + h * 3_600_000);
        return vtFetchJson(`/arrivi/${dest.code}/${encodeURIComponent(formatViaggiatrenoDateString(d))}`);
      });

      const [depResults, arrResults] = await Promise.all([Promise.all(depCalls), Promise.all(arrCalls)]);

      const partenzeByNum = new Map();
      for (const list of depResults) {
        if (!Array.isArray(list)) continue;
        for (const p of list) {
          const num = String(p.numeroTreno || '').trim();
          if (num && !partenzeByNum.has(num)) partenzeByNum.set(num, p);
        }
      }

      const arrivingByNum = new Map();
      for (const list of arrResults) {
        if (!Array.isArray(list)) continue;
        for (const a of list) {
          const num = String(a.numeroTreno || '').trim();
          if (num && !arrivingByNum.has(num)) arrivingByNum.set(num, a);
        }
      }

      for (const [num, p] of partenzeByNum.entries()) {
        const arrMatch = arrivingByNum.get(num);
        const destUpper = String(p.destinazione || '').toUpperCase();
        const targetDestUpper = dest.name.toUpperCase();
        const isDirectMatch = Boolean(arrMatch) || destUpper.includes(targetDestUpper) || targetDestUpper.includes(destUpper);
        if (!isDirectMatch) continue;

        let codOrig = p.codOrigine || '';
        let tsPart = Number(p.millisDataPartenza || p.dataPartenzaTreno || 0);
        if (!codOrig || !tsPart) {
          const auto = await resolveTrainOrigin(num);
          if (auto) {
            codOrig = codOrig || auto.codiceOrigine;
            tsPart = tsPart || auto.timestampPartenza;
          }
        }
        if (!codOrig || !tsPart) continue;

        candidates.set(num, {
          numeroTreno: num,
          codiceOrigine: codOrig,
          timestampPartenza: tsPart,
          categoria: normalizeTrainCategory(p.categoriaDescrizione || p.categoria, num),
          operatore: p.codiceCliente === 18 ? 'Trenitalia Tper' : 'Trenitalia',
          origineTreno: p.origine || orig.name,
          destinazioneTreno: p.destinazione || dest.name,
          orarioPartenza: Number(p.orarioPartenza || tsPart),
          orarioArrivo: Number(arrMatch?.orarioArrivo || 0)
        });
      }
    }

    // Apply route filters (categoria + fascia_oraria)
    const allowedCats = Array.isArray(route.categorie) && route.categorie.length > 0
      ? new Set(route.categorie.map((c) => c.toUpperCase()))
      : null;

    const filtered = Array.from(candidates.values()).filter((t) => {
      if (allowedCats && !allowedCats.has(t.categoria)) return false;
      if (!isWithinTimeBand(t.orarioPartenza, route.fascia_oraria)) return false;
      return true;
    });

    return filtered;
  }

  async function ensureDailyDiscovery(force = false) {
    const dateKey = getRomeDateKey();
    const state = store.getState();
    const config = await store.loadConfig();

    if (!force && state.dailyDiscovery.dateKey === dateKey && Object.keys(state.dailyDiscovery.routes).length > 0) {
      return config;
    }

    console.log(`🚄 Viaggiatreno: avvio discovery treni per ${dateKey} (${config.tratte.length} tratte)`);
    state.dailyDiscovery = { dateKey, routes: {} };
    store.pruneOldAlertStates(dateKey);

    for (const route of config.tratte) {
      if (route.attiva === false) continue;
      const trains = await discoverTrainsForRoute(route);
      state.dailyDiscovery.routes[route.id] = trains;
      console.log(`   ↳ Tratta ${route.origine} → ${route.destinazione}: ${trains.length} treni individuati`);
    }

    store.scheduleSave();
    return config;
  }

  async function pollActiveTrains(forceDiscovery = false) {
    if (isPolling) return;
    isPolling = true;

    try {
      const config = await ensureDailyDiscovery(forceDiscovery);
      const state = store.getState();
      const dateKey = state.dailyDiscovery.dateKey || getRomeDateKey();
      const nowMs = Date.now();

      for (const route of config.tratte) {
        if (route.attiva === false) continue;
        const trains = state.dailyDiscovery.routes[route.id] || [];
        const soglia = Number(route.soglia_ritardo_minuti ?? 10);

        for (const train of trains) {
          if (!isTrainInActiveWindow(train, nowMs)) continue;

          const data = await vtFetchJson(
            `/andamentoTreno/${encodeURIComponent(train.codiceOrigine)}/${encodeURIComponent(train.numeroTreno)}/${encodeURIComponent(train.timestampPartenza)}`
          );
          if (!data) continue;

          const fermate = Array.isArray(data.fermate) ? data.fermate : [];
          const fermateInteresse = fermate
            .filter((f) => {
              const name = String(f.stazione || '').toUpperCase();
              return (
                name.includes(route.origine.toUpperCase()) ||
                name.includes(route.destinazione.toUpperCase()) ||
                Number(f.ritardo || 0) >= soglia
              );
            })
            .map((f) => ({
              stazione: f.stazione,
              ritardo: Number(f.ritardo || 0),
              ritardoPartenza: Number(f.ritardoPartenza || 0),
              ritardoArrivo: Number(f.ritardoArrivo || 0),
              programmata: f.programmata || null,
              effettiva: f.effettiva || null,
              binarioEffettivo: f.binarioEffettivoPartenzaDescrizione || f.binarioEffettivoArrivoDescrizione || null
            }));

          const summary = {
            routeId: route.id,
            tratta: `${route.origine} → ${route.destinazione}`,
            numeroTreno: train.numeroTreno,
            categoria: normalizeTrainCategory(data.categoria || train.categoria, train.numeroTreno),
            operatore: train.operatore || (data.codiceCliente === 18 ? 'Trenitalia Tper' : 'Trenitalia'),
            origine: data.origine || train.origineTreno,
            destinazione: data.destinazione || train.destinazioneTreno,
            ritardo: Number(data.ritardo ?? 0),
            stazioneUltimoRilevamento: data.stazioneUltimoRilevamento || null,
            oraUltimoRilevamento: data.oraUltimoRilevamento || null,
            provvedimento: Number(data.provvedimento || 0),
            tipoTreno: data.tipoTreno || 'PG',
            orarioPartenza: data.orarioPartenza || train.orarioPartenza,
            orarioArrivo: data.orarioArrivo || train.orarioArrivo,
            fermateInteresse,
            updatedAt: nowMs
          };

          liveStatuses.set(`${route.id}:${train.numeroTreno}`, summary);

          // State-tracking & anti-spam alert evaluation
          const alertKey = `${dateKey}:${train.numeroTreno}`;
          const prevAlertState = state.alertState[alertKey];
          const evalRes = evaluateAlertTransition(prevAlertState, summary, soglia);
          state.alertState[alertKey] = evalRes.nextState;

          if (evalRes.shouldAlert) {
            const trainTypeBadge =
              summary.categoria === 'FR' ? 'av' : summary.categoria === 'IC' ? 'ic' : 'reg';

            const alertItem = {
              id: `vt:${dateKey}:${train.numeroTreno}:${nowMs}`,
              feedType: 'viaggiatreno',
              title: `${summary.categoria} ${summary.numeroTreno} (${summary.origine} → ${summary.destinazione}): ${evalRes.alertReason}${summary.stazioneUltimoRilevamento ? ` · Ultimo ril. ${summary.stazioneUltimoRilevamento}` : ''}`,
              link: 'http://www.viaggiatreno.it/',
              description: '',
              pubDate: new Date(nowMs).toUTCString(),
              timestamp: nowMs,
              isoDate: new Date(nowMs).toISOString(),
              regions: ['Viaggiatreno Live'],
              status: evalRes.severity,
              statusLabel: evalRes.severity === 'suspended' ? 'Critico / Soppresso' : 'Ritardo Rilevato',
              trainTypes: [trainTypeBadge],
              line: `${route.origine} - ${route.destinazione}`,
              eventTime: summary.oraUltimoRilevamento
                ? new Date(summary.oraUltimoRilevamento).toLocaleTimeString('it-IT', {
                    timeZone: 'Europe/Rome',
                    hour: '2-digit',
                    minute: '2-digit'
                  }).replace(':', '.')
                : null,
              delayMinutes: summary.ritardo > 0 ? summary.ritardo : null,
              cause: evalRes.alertReason,
              viaggiatreno: summary
            };

            state.alerts.unshift(alertItem);
            if (state.alerts.length > 100) state.alerts = state.alerts.slice(0, 100);
            console.log(`🔔 Alert Viaggiatreno: ${alertItem.title}`);

            if (typeof onAlert === 'function') {
              onAlert(alertItem);
            }
          }

          store.scheduleSave();
        }
      }
    } catch (err) {
      console.error(`⚠️ Errore polling Viaggiatreno: ${err.message}`);
    } finally {
      isPolling = false;
    }
  }

  function start(intervalMs = Number(process.env.VT_POLL_INTERVAL_MS || 60_000)) {
    if (pollTimer) return;
    // Initial non-blocking run
    setTimeout(() => {
      pollActiveTrains(false);
    }, 1500);

    pollTimer = setInterval(() => {
      pollActiveTrains(false);
    }, intervalMs);
  }

  function stop() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function getSnapshot() {
    const config = await store.loadConfig();
    const state = store.getState();
    return {
      dateKey: state.dailyDiscovery.dateKey,
      tratte: config.tratte,
      discoveredByRoute: state.dailyDiscovery.routes,
      liveTrains: Array.from(liveStatuses.values()).sort((a, b) => b.ritardo - a.ritardo),
      alerts: state.alerts
    };
  }

  return {
    resolveStation,
    resolveTrainOrigin,
    discoverTrainsForRoute,
    ensureDailyDiscovery,
    pollActiveTrains,
    start,
    stop,
    getSnapshot
  };
}
