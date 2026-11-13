import { decodeHtmlEntities } from './rss.js';

/**
 * Extracts clean, readable paragraphs and tables from an RFI Infomobilità HTML page.
 * Strips navigation, headers, footers, scripts, and boilerplate.
 */
export function extractArticleContent(htmlString) {
  if (!htmlString) {
    return { title: '', paragraphs: [], tables: [], pdfLinks: [] };
  }

  // Extract page title / og:title
  const ogTitleMatch = htmlString.match(/<meta\s+property=["']og:title["']\s+content=["']([\s\S]*?)["']/i);
  const title = ogTitleMatch ? decodeHtmlEntities(ogTitleMatch[1]) : '';

  // Remove script, style, header, footer, nav blocks to isolate content
  let cleaned = htmlString
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ');

  // Narrow down to main content if breadcrumbs exist (RFI AEM pages put article right after breadcrumbs)
  const crumbIdx = cleaned.indexOf('breadcrumbs-and-kits');
  if (crumbIdx !== -1) {
    cleaned = cleaned.slice(crumbIdx);
  }

  // Extract PDF links if any (often timetables or strike/bus attachments)
  const pdfLinks = [];
  const seenPdf = new Set();
  const pdfRegex = /<a\b[^>]*href=["']([^"']+\.pdf[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let pdfMatch;
  while ((pdfMatch = pdfRegex.exec(cleaned)) !== null) {
    let href = pdfMatch[1].trim();
    if (href.startsWith('/')) {
      href = `https://www.rfi.it${href}`;
    }
    const label = decodeHtmlEntities(pdfMatch[2].replace(/<[^>]+>/g, '')) || 'Documento PDF';
    if (!seenPdf.has(href)) {
      seenPdf.add(href);
      pdfLinks.push({ url: href, label });
    }
  }

  // Extract tables
  const tables = [];
  const tableRegex = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRegex.exec(cleaned)) !== null) {
    const rows = [];
    const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = trRegex.exec(tableMatch[1])) !== null) {
      const cells = [];
      const cellRegex = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
        cells.push(decodeHtmlEntities(cellMatch[1].replace(/<[^>]+>/g, ' ')));
      }
      if (cells.some((c) => c.length > 0)) {
        rows.push(cells);
      }
    }
    if (rows.length > 0) {
      tables.push(rows);
    }
  }

  // Remove tables before extracting standalone paragraphs so we don't duplicate table cells
  const withoutTables = cleaned.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, ' ');

  const BOILERPLATE_PATTERNS = [
    /^Piazza della Croce Rossa/i,
    /^Per consultare i monitor aggiornati/i,
    /^Rete Ferroviaria Italiana/i,
    /^Copyright/i,
    /^Seguici su/i,
    /^Cookie/i,
    /^Informativa/i,
    /^Partita IVA/i,
    /^Società soggetta/i
  ];

  const paragraphs = [];
  const seenText = new Set();
  const pRegex = /<(?:p|li|h2|h3)\b[^>]*>([\s\S]*?)<\/(?:p|li|h2|h3)>/gi;
  let pMatch;
  while ((pMatch = pRegex.exec(withoutTables)) !== null) {
    const text = decodeHtmlEntities(pMatch[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));
    if (text.length < 15) continue;
    if (BOILERPLATE_PATTERNS.some((re) => re.test(text))) continue;
    if (seenText.has(text)) continue;
    seenText.add(text);
    paragraphs.push(text);
  }

  return {
    title,
    paragraphs: paragraphs.slice(0, 40),
    tables: tables.slice(0, 6),
    pdfLinks: pdfLinks.slice(0, 10)
  };
}
