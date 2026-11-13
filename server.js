import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RFI_REGIONS, buildFeedUrls, parseRssFeed } from './lib/rss.js';
import { extractArticleContent } from './lib/article.js';
import { createStore } from './lib/store.js';
import { createViaggiatrenoService } from './lib/viaggiatreno.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const STATE_PATH = path.join(__dirname, 'data', 'state.json');

const PORT = Number(process.env.PORT || 3080);
const HOST = process.env.HOST || '0.0.0.0';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 180_000); // 3 minutes (matches RFI max-age=180)
const ARTICLE_CACHE_TTL_MS = Number(process.env.ARTICLE_CACHE_TTL_MS || 600_000); // 10 minutes
const FETCH_TIMEOUT_MS = 12_000;

const store = createStore({ configPath: CONFIG_PATH, statePath: STATE_PATH });
const viaggiatrenoService = createViaggiatrenoService({ store });

const feedCache = new Map();
const articleCache = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'RFI-Infomobilita-Hub/1.0 (+https://github.com/volpinariluca/rfi-infomobilita)',
        Accept: 'application/xml, text/xml, text/html, */*'
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} da ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function getFeedsForRegion(regionId, forceRefresh = false) {
  const key = regionId || 'emilia_romagna';
  const cached = feedCache.get(key);
  const now = Date.now();

  if (!forceRefresh && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached.data, fromCache: true };
  }

  const urls = buildFeedUrls(key);
  const [updatesRes, noticesRes] = await Promise.allSettled([
    fetchWithTimeout(urls.updates),
    fetchWithTimeout(urls.notices)
  ]);

  const errors = [];
  let updates = { items: [], channelTitle: '', channelLink: urls.updates };
  let notices = { items: [], channelTitle: '', channelLink: urls.notices };

  if (updatesRes.status === 'fulfilled') {
    updates = parseRssFeed(updatesRes.value, 'updates');
  } else {
    errors.push(`Aggiornamenti: ${updatesRes.reason?.message || 'errore di rete'}`);
  }

  if (noticesRes.status === 'fulfilled') {
    notices = parseRssFeed(noticesRes.value, 'notices');
  } else {
    errors.push(`Avvisi: ${noticesRes.reason?.message || 'errore di rete'}`);
  }

  // Fallback to stale cache if both failed
  if (errors.length === 2 && cached) {
    return { ...cached.data, fromCache: true, stale: true, errors };
  }

  const allItems = [...updates.items, ...notices.items].sort((a, b) => b.timestamp - a.timestamp);

  const payload = {
    region: key,
    regionLabel: RFI_REGIONS.find((r) => r.id === key)?.label || key,
    fetchedAt: new Date(now).toISOString(),
    cacheTtlSeconds: Math.round(CACHE_TTL_MS / 1000),
    sources: urls,
    counts: {
      total: allItems.length,
      updates: updates.items.length,
      notices: notices.items.length
    },
    errors,
    items: allItems
  };

  if (errors.length < 2) {
    feedCache.set(key, { fetchedAt: now, data: payload });
  }

  return { ...payload, fromCache: false };
}

async function getArticleDetails(articleUrl) {
  let parsed;
  try {
    parsed = new URL(articleUrl);
  } catch {
    throw new Error('URL non valido');
  }

  // Strict SSRF protection: allow only official RFI HTTPS pages
  if (parsed.protocol !== 'https:' || (parsed.hostname !== 'www.rfi.it' && parsed.hostname !== 'rfi.it')) {
    throw new Error('Dominio non consentito: solo pagine ufficiali www.rfi.it');
  }

  const now = Date.now();
  const cached = articleCache.get(parsed.href);
  if (cached && now - cached.fetchedAt < ARTICLE_CACHE_TTL_MS) {
    return { ...cached.data, fromCache: true };
  }

  const html = await fetchWithTimeout(parsed.href);
  const extracted = extractArticleContent(html);
  const data = {
    url: parsed.href,
    fetchedAt: new Date(now).toISOString(),
    ...extracted
  };

  articleCache.set(parsed.href, { fetchedAt: now, data });
  return { ...data, fromCache: false };
}

function sendJson(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(json);
}

async function serveStatic(reqPath, res) {
  const cleanPath = reqPath === '/' ? '/index.html' : reqPath;
  const resolved = path.resolve(PUBLIC_DIR, `.${cleanPath}`);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    } else {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64_000) {
        reject(new Error('Payload troppo grande'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON non valido'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    let version = '1.1.0';
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(__dirname, 'package.json'), 'utf8'));
      version = pkg.version || version;
    } catch {
      // Fallback
    }
    return sendJson(res, 200, {
      status: 'ok',
      version,
      uptimeSeconds: Math.round(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/regions') {
    return sendJson(res, 200, { regions: RFI_REGIONS });
  }

  if (req.method === 'GET' && url.pathname === '/api/feeds') {
    const region = url.searchParams.get('region') || 'emilia_romagna';
    const force = url.searchParams.get('refresh') === '1';
    try {
      const data = await getFeedsForRegion(region, force);
      const vtAlerts = store.getState().alerts || [];
      const mergedItems = [...vtAlerts, ...(data.items || [])].sort((a, b) => b.timestamp - a.timestamp);
      return sendJson(res, 200, {
        ...data,
        counts: {
          ...data.counts,
          viaggiatreno: vtAlerts.length,
          total: mergedItems.length
        },
        items: mergedItems
      });
    } catch (err) {
      return sendJson(res, 502, { error: err.message || 'Errore nel recupero dei feed RFI' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/tratte') {
    const snapshot = await viaggiatrenoService.getSnapshot();
    return sendJson(res, 200, snapshot);
  }

  if (req.method === 'POST' && url.pathname === '/api/tratte') {
    try {
      const body = await readJsonBody(req);
      const origine = String(body.origine || '').trim().toUpperCase();
      const destinazione = String(body.destinazione || '').trim().toUpperCase();
      if (!origine || !destinazione) {
        return sendJson(res, 400, { error: 'Origine e destinazione sono obbligatorie' });
      }
      const config = await store.loadConfig();
      const id = body.id || `${origine.slice(0, 3)}-${destinazione.slice(0, 3)}-${Date.now().toString(36)}`.toLowerCase();
      const newRoute = {
        id,
        origine,
        destinazione,
        soglia_ritardo_minuti: Number(body.soglia_ritardo_minuti ?? 10),
        categorie: Array.isArray(body.categorie) && body.categorie.length > 0 ? body.categorie : ['FR', 'IC', 'REG', 'RV'],
        fascia_oraria: body.fascia_oraria || null,
        attiva: body.attiva !== false
      };
      config.tratte.push(newRoute);
      await store.saveConfig(config);
      viaggiatrenoService.pollActiveTrains(true);
      return sendJson(res, 201, { route: newRoute });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Richiesta non valida' });
    }
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/tratte/')) {
    const routeId = decodeURIComponent(url.pathname.slice('/api/tratte/'.length));
    const config = await store.loadConfig();
    const before = config.tratte.length;
    config.tratte = config.tratte.filter((t) => t.id !== routeId);
    if (config.tratte.length === before) {
      return sendJson(res, 404, { error: 'Tratta non trovata' });
    }
    await store.saveConfig(config);
    delete store.getState().dailyDiscovery.routes[routeId];
    store.scheduleSave();
    return sendJson(res, 200, { deleted: routeId });
  }

  if (req.method === 'POST' && url.pathname === '/api/tratte/refresh') {
    await viaggiatrenoService.pollActiveTrains(true);
    const snapshot = await viaggiatrenoService.getSnapshot();
    return sendJson(res, 200, snapshot);
  }

  if (req.method === 'GET' && url.pathname === '/api/article') {
    const articleUrl = url.searchParams.get('url');
    if (!articleUrl) {
      return sendJson(res, 400, { error: 'Parametro url mancante' });
    }
    try {
      const data = await getArticleDetails(articleUrl);
      return sendJson(res, 200, data);
    } catch (err) {
      const code = err.message.includes('consentito') || err.message.includes('valido') ? 400 : 502;
      return sendJson(res, code, { error: err.message || 'Errore nel recupero del dettaglio' });
    }
  }

  if (req.method === 'GET') {
    return serveStatic(url.pathname, res);
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
});

await store.loadState();

server.listen(PORT, HOST, () => {
  console.log(`🚆 RFI Infomobilità Hub attivo su http://${HOST}:${PORT}`);
  viaggiatrenoService.start();
});
