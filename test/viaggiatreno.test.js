import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createStore } from '../lib/store.js';
import {
  parseStationAutocomplete,
  parseTrainAutocomplete,
  isTrainInActiveWindow,
  evaluateAlertTransition,
  normalizeTrainCategory,
  createViaggiatrenoService
} from '../lib/viaggiatreno.js';

test('parseStationAutocomplete selects exact or first match', () => {
  const sample = 'BOLOGNA BORGO PANIGALE|S05100\nBOLOGNA CENTRALE|S05043\n';
  assert.deepEqual(parseStationAutocomplete(sample, 'BOLOGNA CENTRALE'), {
    name: 'BOLOGNA CENTRALE',
    code: 'S05043'
  });
  assert.deepEqual(parseStationAutocomplete(sample, 'BOLOGNA'), {
    name: 'BOLOGNA BORGO PANIGALE',
    code: 'S05100'
  });
});

test('parseTrainAutocomplete parses train number, origin code, and departure timestamp', () => {
  const sample = '9630 - NAPOLI CENTRALE - 13/11/26|9630-S09218-1794524400000\n';
  assert.deepEqual(parseTrainAutocomplete(sample), {
    numeroTreno: '9630',
    codiceOrigine: 'S09218',
    timestampPartenza: 1794524400000
  });
});

test('isTrainInActiveWindow enforces [partenza - 15m, arrivo + 60m]', () => {
  const base = 1_700_000_000_000;
  const train = { orarioPartenza: base, orarioArrivo: base + 60 * 60_000 };

  assert.equal(isTrainInActiveWindow(train, base - 20 * 60_000), false);
  assert.equal(isTrainInActiveWindow(train, base - 10 * 60_000), true);
  assert.equal(isTrainInActiveWindow(train, base + 90 * 60_000), true);
  assert.equal(isTrainInActiveWindow(train, base + 125 * 60_000), false);
});

test('evaluateAlertTransition implements +5 min hysteresis and immediate suppression/deviation alerts', () => {
  // Below threshold -> no alert
  let res = evaluateAlertTransition(undefined, { ritardo: 5, tipoTreno: 'PG', provvedimento: 0 }, 10);
  assert.equal(res.shouldAlert, false);

  // Reaches threshold -> alert
  res = evaluateAlertTransition(res.nextState, { ritardo: 12, tipoTreno: 'PG', provvedimento: 0 }, 10);
  assert.equal(res.shouldAlert, true);
  assert.equal(res.alertReason, 'Ritardo di +12 min');

  // +3 min increase (< 5) -> no spam
  res = evaluateAlertTransition(res.nextState, { ritardo: 15, tipoTreno: 'PG', provvedimento: 0 }, 10);
  assert.equal(res.shouldAlert, false);

  // +5 min increase from last alerted (12 -> 17) -> alert
  res = evaluateAlertTransition(res.nextState, { ritardo: 17, tipoTreno: 'PG', provvedimento: 0 }, 10);
  assert.equal(res.shouldAlert, true);
  assert.equal(res.alertReason, 'Ritardo di +17 min');

  // Suppression detected -> immediate alert
  res = evaluateAlertTransition(res.nextState, { ritardo: 17, tipoTreno: 'ST', provvedimento: 1 }, 10);
  assert.equal(res.shouldAlert, true);
  assert.equal(res.severity, 'suspended');
});

test('normalizeTrainCategory infers FR/IC/REG cleanly', () => {
  assert.equal(normalizeTrainCategory('', '9630'), 'FR');
  assert.equal(normalizeTrainCategory('IC', '580'), 'IC');
  assert.equal(normalizeTrainCategory('RV', '2460'), 'RV');
});

test('createViaggiatrenoService handles discovery, polling, and 5xx resilience', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-test-'));
  const configPath = path.join(tmpDir, 'config.json');
  const statePath = path.join(tmpDir, 'state.json');
  const now = Date.now();

  await fs.writeFile(
    configPath,
    JSON.stringify({
      tratte: [
        {
          id: 'bo-mi',
          origine: 'BOLOGNA CENTRALE',
          destinazione: 'MILANO CENTRALE',
          soglia_ritardo_minuti: 10,
          categorie: ['FR'],
          attiva: true
        }
      ]
    })
  );

  const store = createStore({ configPath, statePath });
  await store.loadState();

  const mockFetch = async (url) => {
    if (url.includes('/autocompletaStazione/BOLOGNA')) {
      return new Response('BOLOGNA CENTRALE|S05043\n', { status: 200 });
    }
    if (url.includes('/autocompletaStazione/MILANO')) {
      return new Response('MILANO CENTRALE|S01700\n', { status: 200 });
    }
    if (url.includes('/soluzioniViaggioNew/')) {
      return new Response(
        JSON.stringify({
          soluzioni: [
            {
              vehicles: [
                {
                  numeroTreno: '9630',
                  categoria: 'FR',
                  origine: 'BOLOGNA CENTRALE',
                  destinazione: 'MILANO CENTRALE',
                  orarioPartenza: new Date(now).toISOString(),
                  orarioArrivo: new Date(now + 60 * 60_000).toISOString()
                }
              ]
            }
          ]
        }),
        { status: 200 }
      );
    }
    if (url.includes('/cercaNumeroTrenoTrenoAutocomplete/9630')) {
      return new Response(`9630 - NAPOLI CENTRALE|9630-S09218-${now}\n`, { status: 200 });
    }
    if (url.includes('/andamentoTreno/S09218/9630/')) {
      return new Response(
        JSON.stringify({
          numeroTreno: 9630,
          categoria: 'FR',
          origine: 'NAPOLI CENTRALE',
          destinazione: 'MILANO CENTRALE',
          ritardo: 18,
          stazioneUltimoRilevamento: 'REGGIO EMILIA AV',
          oraUltimoRilevamento: now,
          provvedimento: 0,
          tipoTreno: 'PG',
          orarioPartenza: now,
          orarioArrivo: now + 60 * 60_000,
          fermate: [
            { stazione: 'BOLOGNA CENTRALE', ritardo: 12 },
            { stazione: 'MILANO CENTRALE', ritardo: 18 }
          ]
        }),
        { status: 200 }
      );
    }
    return new Response('Service Unavailable', { status: 503 });
  };

  const alertsReceived = [];
  const service = createViaggiatrenoService({
    store,
    fetchImpl: mockFetch,
    onAlert: (a) => alertsReceived.push(a)
  });

  await service.pollActiveTrains(true);
  const snap = await service.getSnapshot();

  assert.equal(snap.liveTrains.length, 1);
  assert.equal(snap.liveTrains[0].ritardo, 18);
  assert.equal(alertsReceived.length, 1);
  assert.match(alertsReceived[0].title, /9630/);
  assert.equal(alertsReceived[0].delayMinutes, 18);

  // Polling again with same delay should not emit duplicate alert
  await service.pollActiveTrains(false);
  assert.equal(alertsReceived.length, 1);
});
