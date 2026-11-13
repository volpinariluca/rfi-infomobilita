import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Lightweight JSON persistence for station codes, daily train discovery,
 * alert state-tracking (anti-spam), and Viaggiatreno real-time alerts.
 */
export function createStore({ configPath, statePath }) {
  let state = {
    stations: {},
    dailyDiscovery: {
      dateKey: '',
      routes: {}
    },
    alertState: {},
    alerts: []
  };

  let saveTimer = null;

  async function loadConfig() {
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.tratte) ? parsed : { tratte: [] };
    } catch {
      return { tratte: [] };
    }
  }

  async function saveConfig(config) {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  }

  async function loadState() {
    try {
      const raw = await fs.readFile(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      state = {
        stations: parsed.stations || {},
        dailyDiscovery: parsed.dailyDiscovery || { dateKey: '', routes: {} },
        alertState: parsed.alertState || {},
        alerts: Array.isArray(parsed.alerts) ? parsed.alerts : []
      };
    } catch {
      // First run or corrupted state file: start clean
    }
    return state;
  }

  async function flushState() {
    try {
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      console.error(`⚠️ Errore salvataggio stato Viaggiatreno: ${err.message}`);
    }
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flushState();
    }, 500);
  }

  function getState() {
    return state;
  }

  function pruneOldAlertStates(currentDateKey) {
    const prefix = `${currentDateKey}:`;
    for (const key of Object.keys(state.alertState)) {
      if (!key.startsWith(prefix)) {
        delete state.alertState[key];
      }
    }
    // Keep last 100 alerts
    if (state.alerts.length > 100) {
      state.alerts = state.alerts.slice(0, 100);
    }
  }

  return {
    loadConfig,
    saveConfig,
    loadState,
    flushState,
    scheduleSave,
    getState,
    pruneOldAlertStates
  };
}
