import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRssFeed, classifyItem, buildFeedUrls, decodeHtmlEntities } from '../lib/rss.js';
import { extractArticleContent } from '../lib/article.js';

test('decodeHtmlEntities handles Italian accents and entities', () => {
  assert.equal(decodeHtmlEntities('Infomobilit&agrave; &ndash; Ciano d&rsquo;Enza'), 'Infomobilità – Ciano d’Enza');
});

test('buildFeedUrls builds regional and national URLs', () => {
  const er = buildFeedUrls('emilia_romagna');
  assert.equal(er.updates, 'https://www.rfi.it/content/rfi/it/news-e-media/infomobilita.rss.updates.emilia_romagna.xml');
  assert.equal(er.notices, 'https://www.rfi.it/content/rfi/it/news-e-media/infomobilita.rss.notices.emilia_romagna.xml');

  const nat = buildFeedUrls('nazionale');
  assert.equal(nat.updates, 'https://www.rfi.it/content/rfi/it/news-e-media/infomobilita.rss.updates.xml');
});

test('classifyItem detects status, train types, time, delay, and cause', () => {
  const resolved = classifyItem(
    'Linea AV Bologna - Milano, dalle ore 19.50 circolazione ferroviaria tornata regolare tra Reggio Emilia e Rubiera dopo un inconveniente tecnico a un treno',
    'updates',
    ['Emilia Romagna']
  );
  assert.equal(resolved.status, 'resolved');
  assert.ok(resolved.trainTypes.includes('av'));
  assert.equal(resolved.eventTime, '19.50');
  assert.equal(resolved.cause, 'Guasto treno');
  assert.equal(resolved.line, 'Linea AV Bologna - Milano');

  const suspended = classifyItem(
    'Linea Bologna - Rimini: circolazione sospesa tra Santarcangelo e Rimini per intervento dei Vigili del Fuoco, ritardi fino a 45 minuti',
    'updates',
    ['Emilia Romagna']
  );
  assert.equal(suspended.status, 'suspended');
  assert.equal(suspended.delayMinutes, 45);
  assert.equal(suspended.cause, 'Vigili del Fuoco');
  assert.ok(suspended.trainTypes.includes('reg'));

  const strike = classifyItem(
    'Sciopero nazionale del personale ferroviario',
    'notices',
    ['Emilia Romagna', 'Lombardia']
  );
  assert.equal(strike.status, 'strike');
  assert.equal(strike.cause, 'Sciopero');
});

test('parseRssFeed parses real-world RFI XML structure', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss xmlns:rfi="/content/rfi/it/news-e-media/infomobilita" version="2.0">
    <channel>
      <title>RFI Emilia Romagna</title>
      <link>https://www.rfi.it</link>
      <item>
        <title>LINEA BOLOGNA-PARMA</title>
        <link>https://www.rfi.it/content/rfi/it/news-e-media/infomobilita/avvisi/2026/10/2/linea-bologna-parma.html</link>
        <pubDate>Fri, 02 Oct 2026 00:01:00 +0200</pubDate>
        <guid>https://www.rfi.it/avvisi/1</guid>
        <rfi:region>Emilia Romagna, Lombardia</rfi:region>
      </item>
    </channel>
  </rss>`;
  const parsed = parseRssFeed(xml, 'notices');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].feedType, 'notices');
  assert.deepEqual(parsed.items[0].regions, ['Emilia Romagna', 'Lombardia']);
  assert.equal(parsed.items[0].status, 'planned');
});

test('extractArticleContent extracts paragraphs, tables, and strips boilerplate', () => {
  const html = `
    <html><head><meta property="og:title" content="Linea Bologna - Parma"></head>
    <body>
      <div class="breadcrumbs-and-kits"></div>
      <p>Dal 2 ottobre al 5 dicembre, per lavori di manutenzione programmata, i treni in tabella subiscono modifiche.</p>
      <table><tr><th>Treno</th><th>Note</th></tr><tr><td>17402</td><td>Bus B0142</td></tr></table>
      <p>Piazza della Croce Rossa 1 - 00161 Roma</p>
    </body></html>`;
  const res = extractArticleContent(html);
  assert.equal(res.title, 'Linea Bologna - Parma');
  assert.equal(res.paragraphs.length, 1);
  assert.match(res.paragraphs[0], /Dal 2 ottobre/);
  assert.equal(res.tables.length, 1);
  assert.equal(res.tables[0][1][0], '17402');
});
