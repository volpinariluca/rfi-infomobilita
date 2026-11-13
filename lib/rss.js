/**
 * RFI Infomobilità RSS XML parser & smart classifier.
 * Zero external dependencies for effortless deployment on home servers (S21/ARM64/Docker/Termux).
 */

export const RFI_REGIONS = [
  { id: 'emilia_romagna', label: 'Emilia-Romagna' },
  { id: 'nazionale', label: 'Nazionale (Tutti)' },
  { id: 'lombardia', label: 'Lombardia' },
  { id: 'toscana', label: 'Toscana' },
  { id: 'veneto', label: 'Veneto' },
  { id: 'lazio', label: 'Lazio' },
  { id: 'piemonte', label: 'Piemonte' },
  { id: 'liguria', label: 'Liguria' },
  { id: 'marche', label: 'Marche' },
  { id: 'campania', label: 'Campania' },
  { id: 'puglia', label: 'Puglia' },
  { id: 'sicilia', label: 'Sicilia' },
  { id: 'calabria', label: 'Calabria' },
  { id: 'abruzzo', label: 'Abruzzo' },
  { id: 'friuli_venezia_giulia', label: 'Friuli-Venezia Giulia' },
  { id: 'trentino_alto_adige', label: 'Trentino-Alto Adige' },
  { id: 'umbria', label: 'Umbria' },
  { id: 'basilicata', label: 'Basilicata' },
  { id: 'molise', label: 'Molise' },
  { id: 'sardegna', label: 'Sardegna' },
  { id: 'valle_daosta', label: "Valle d'Aosta" }
];

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  agrave: 'à',
  egrave: 'è',
  eacute: 'é',
  igrave: 'ì',
  ograve: 'ò',
  ugrave: 'ù',
  Agrave: 'À',
  Egrave: 'È',
  Eacute: 'É',
  Igrave: 'Ì',
  Ograve: 'Ò',
  Ugrave: 'Ù',
  euro: '€',
  deg: '°'
};

export function decodeHtmlEntities(str = '') {
  return String(str)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (full, name) => NAMED_ENTITIES[name] ?? full)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block, tagName) {
  const escaped = tagName.replace(':', '\\:');
  const regex = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i');
  const match = block.match(regex);
  return match ? decodeHtmlEntities(match[1]) : '';
}

export function buildFeedUrls(regionId = 'emilia_romagna') {
  const valid = RFI_REGIONS.some((r) => r.id === regionId) ? regionId : 'emilia_romagna';
  if (valid === 'nazionale') {
    return {
      updates: 'https://www.rfi.it/content/rfi/it/news-e-media/infomobilita.rss.updates.xml',
      notices: 'https://www.rfi.it/content/rfi/it/news-e-media/infomobilita.rss.notices.xml'
    };
  }
  return {
    updates: `https://www.rfi.it/content/rfi/it/news-e-media/infomobilita.rss.updates.${valid}.xml`,
    notices: `https://www.rfi.it/content/rfi/it/news-e-media/infomobilita.rss.notices.${valid}.xml`
  };
}

/**
 * Classifies an RSS item into structured railway metadata.
 */
export function classifyItem(title, feedType, regions = []) {
  const t = title || '';
  const lower = t.toLowerCase();

  // 1. Status & Severity
  let status = feedType === 'notices' ? 'planned' : 'info';
  let statusLabel = feedType === 'notices' ? 'Avviso Programmato' : 'Aggiornamento';

  if (/\bsciopero\b/i.test(lower)) {
    status = 'strike';
    statusLabel = 'Sciopero';
  } else if (feedType === 'updates') {
    if (/(tornata regolare|riattivata|ripresa|concluso|risolto|regolarizzata)/i.test(lower)) {
      status = 'resolved';
      statusLabel = 'Tornata Regolare';
    } else if (/(sospesa|interrotta|bloccata|chiusa|cancellat)/i.test(lower)) {
      status = 'suspended';
      statusLabel = 'Circolazione Sospesa';
    } else if (/(rallentat|ritard|inconveniente|guasto|accertamenti|deviazion|limitazion)/i.test(lower)) {
      status = 'delayed';
      statusLabel = 'Rallentamenti';
    }
  } else {
    // Notices (Avvisi)
    if (/(sospensione|interruzione|chiusura)/i.test(lower)) {
      status = 'planned';
      statusLabel = 'Lavori / Interruzione';
    } else if (/(lavori|manutenzione|potenziamento|adeguamento)/i.test(lower)) {
      status = 'planned';
      statusLabel = 'Lavori Programmati';
    }
  }

  // 2. Train / Service Categories (Frecce/AV, Intercity, Regionale)
  const trainTypes = new Set();

  if (/\b(av|alta velocit[àa]|frecciarossa|frecciargento|frecciabianca|frecce|italo|direttissima)\b/i.test(lower)) {
    trainTypes.add('av');
  }
  if (/\b(intercity|ic|icn|notte)\b/i.test(lower)) {
    trainTypes.add('ic');
  }
  if (/\b(regionale|regionali|tper|suburbano|metropolitano|sfm)\b/i.test(lower)) {
    trainTypes.add('reg');
  }

  // Heuristic inference from corridor when explicit train type isn't in title
  const isLongDistanceCorridor =
    regions.length >= 3 ||
    /(roma|napoli|salerno|torino|venezia|trieste|reggio c\.|reggio calabria|palermo|siracusa|bolzano|lecce|bari|pescara|ancona|taranto|sibari|perugia)/i.test(lower);

  const isLocalEmiliaLine =
    /(ciano|sassuolo|vignola|porretta|poggio rusco|ravenna|cesenatico|ferrara|rimini|parma|piacenza|reggio emilia|modena|fidenza|castelfranco|imola|faenza|forl[ìi]|cesena|s\.? ilario|santarcangelo|cattolica|rubiera|piadena|brescia)/i.test(lower);

  if (trainTypes.size === 0) {
    if (isLongDistanceCorridor) {
      trainTypes.add('ic');
      if (/(milano|bologna|firenze|roma|napoli|torino|venezia)/i.test(lower)) {
        trainTypes.add('av');
      }
      if (regions.includes('Emilia Romagna') || isLocalEmiliaLine) {
        trainTypes.add('reg');
      }
    } else if (isLocalEmiliaLine || regions.length <= 2) {
      trainTypes.add('reg');
      if (/(bologna\s*[-–]\s*milano|bologna\s*[-–]\s*rimini|bologna\s*[-–]\s*ancona|bologna\s*[-–]\s*firenze|bologna\s*[-–]\s*parma|bologna\s*[-–]\s*venezia)/i.test(lower)) {
        trainTypes.add('ic');
      }
    } else {
      trainTypes.add('reg');
    }
  }

  // 3. Extract Line / Route name
  let line = '';
  const lineMatch = t.match(/^(Line[ae]?\s+(?:AV\s+)?[^,.:]+?)(?:,|:|\s+dalle\s+ore|\s+circolazione|\s+in\s+direzione|\s+per\s+)/i);
  if (lineMatch) {
    line = lineMatch[1].trim();
  } else if (/^Line[ae]?\s+/i.test(t) && t.length > 90) {
    line = t.slice(0, 87).trim() + '…';
  }
  if (line.toLowerCase() === t.trim().toLowerCase()) {
    line = '';
  }

  // 4. Extract event time (e.g., "dalle ore 19.50" or "ore 18:15")
  const timeMatch = t.match(/(?:dalle\s+)?ore\s+(\d{1,2}[.:]\d{2}|\d{1,2})/i);
  const eventTime = timeMatch ? timeMatch[1].replace(':', '.') : null;

  // 5. Extract delay if mentioned
  const delayMatch = t.match(/(\d+)\s*minut[io]/i);
  const delayMinutes = delayMatch ? Number(delayMatch[1]) : null;

  // 6. Extract Cause
  let cause = null;
  if (/sciopero/i.test(lower)) cause = 'Sciopero';
  else if (/inconveniente tecnico a un treno|guasto.*treno/i.test(lower)) cause = 'Guasto treno';
  else if (/inconveniente tecnico|guasto/i.test(lower)) cause = 'Guasto infrastruttura';
  else if (/vigili del fuoco/i.test(lower)) cause = 'Vigili del Fuoco';
  else if (/persone non autorizzate|investimento/i.test(lower)) cause = 'Presenza persone / Sicurezza';
  else if (/maltempo|meteo|neve|vento|pioggia|allagamento/i.test(lower)) cause = 'Maltempo';
  else if (/automezzo|passaggio a livello|danni all['’]infrastruttura/i.test(lower)) cause = 'Danni infrastruttura';
  else if (/accertamenti/i.test(lower)) cause = 'Accertamenti tecnici';
  else if (/lavori|manutenzione|potenziamento/i.test(lower)) cause = 'Lavori programmati';

  return {
    status,
    statusLabel,
    trainTypes: Array.from(trainTypes),
    line,
    eventTime,
    delayMinutes,
    cause
  };
}

/**
 * Parses an RFI RSS 2.0 XML string into normalized, classified items.
 */
export function parseRssFeed(xmlString, feedType = 'updates') {
  const channelTitle = extractTag(xmlString, 'title');
  const channelLink = extractTag(xmlString, 'link');
  const itemMatches = xmlString.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  const items = itemMatches.map((block) => {
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDateRaw = extractTag(block, 'pubDate');
    const guid = extractTag(block, 'guid') || link || title;
    const regionRaw = extractTag(block, 'rfi:region');
    const description = extractTag(block, 'description');

    const regions = regionRaw
      ? regionRaw
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean)
      : [];

    const parsedDate = pubDateRaw ? new Date(pubDateRaw) : null;
    const timestamp = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.getTime() : 0;

    const classification = classifyItem(title, feedType, regions);

    return {
      id: guid,
      feedType,
      title,
      link,
      description,
      pubDate: pubDateRaw,
      timestamp,
      isoDate: timestamp ? new Date(timestamp).toISOString() : null,
      regions,
      ...classification
    };
  });

  return {
    channelTitle,
    channelLink,
    feedType,
    items
  };
}
