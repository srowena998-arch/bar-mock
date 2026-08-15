/**
 * Free Lightweight Web Search Engine for Philippine Legal Case Lookup
 */
async function searchWebJurisprudence(query, maxResults = 3) {
  if (!query || !query.trim()) return [];

  try {
    const encoded = encodeURIComponent(`${query} Philippine Supreme Court lawphil sc.judiciary.gov.ph`);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(6000)
    });

    if (!res.ok) return [];

    const html = await res.text();
    const results = [];

    // Parse duckduckgo result links and snippets
    const regex = /<h2 class="result__title">[\s\S]*?<a class="result__url" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
      let rawUrl = match[1];
      let title = match[2].replace(/<[^>]*>/g, '').trim();
      let snippet = match[3].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

      // Clean DuckDuckGo uddg redirect URL
      let cleanUrl = rawUrl;
      const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try { cleanUrl = decodeURIComponent(uddgMatch[1]); } catch(e) {}
      }

      if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;

      if (snippet.length > 20) {
        results.push({
          title: title || query,
          url: cleanUrl,
          snippet: snippet.slice(0, 320)
        });
        if (results.length >= maxResults) break;
      }
    }

    // Fallback regex if HTML structure differs slightly
    if (results.length === 0) {
      const fallbackSnippetRegex = /<a class="result__snippet[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      let fMatch;
      while ((fMatch = fallbackSnippetRegex.exec(html)) !== null) {
        let rawUrl = fMatch[1];
        let snippet = fMatch[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        let cleanUrl = rawUrl;
        const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          try { cleanUrl = decodeURIComponent(uddgMatch[1]); } catch(e) {}
        }
        if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;

        if (snippet.length > 20) {
          results.push({
            title: `Philippine Jurisprudence: ${query.slice(0, 60)}`,
            url: cleanUrl,
            snippet: snippet.slice(0, 320)
          });
          if (results.length >= maxResults) break;
        }
      }
    }

    return results;
  } catch (err) {
    return [];
  }
}

module.exports = {
  searchWebJurisprudence
};
