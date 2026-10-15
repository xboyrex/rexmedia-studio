/**
 * RexMedia Studio - public-content fetch Worker.
 * No secrets, API keys, cookies, or user sign-in are required.
 * The proxy is intentionally allow-listed to known platform/CDN domains.
 */
const ALLOWED_EXACT = new Set([
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'ytimg.com',
  'instagram.com', 'instagr.am', 'cdninstagram.com', 'fbcdn.net', 'googlevideo.com'
]);
const ALLOWED_SUFFIXES = [
  '.youtube.com', '.youtu.be', '.youtube-nocookie.com', '.ytimg.com', '.googlevideo.com',
  '.instagram.com', '.instagr.am', '.cdninstagram.com', '.fbcdn.net'
];
const MAX_REDIRECTS = 5;
const MAX_TARGET_LENGTH = 8192;

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Content-Disposition, Content-Range, Accept-Ranges',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...headers }),
  });
}

function isAllowedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (ALLOWED_EXACT.has(host)) return true;
  return ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function validateTarget(raw) {
  if (!raw || raw.length > MAX_TARGET_LENGTH) throw new Error('A valid target URL is required.');
  let url;
  try { url = new URL(raw); } catch (_) { throw new Error('The target URL is invalid.'); }
  if (url.protocol !== 'https:') throw new Error('Only HTTPS source URLs are allowed.');
  if (url.username || url.password) throw new Error('URLs containing credentials are not allowed.');
  if (url.port && url.port !== '443') throw new Error('Custom ports are not allowed.');
  if (!isAllowedHost(url.hostname)) throw new Error('This hostname is not on the public-content allow-list.');
  url.hash = '';
  return url;
}

function sourceHeaders(url, incomingRequest) {
  const headers = new Headers({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': incomingRequest.headers.get('Accept') || 'text/html,application/xhtml+xml,application/json,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  });
  const host = url.hostname.toLowerCase();
  if (host.includes('instagram') || host.includes('cdninstagram') || host.includes('fbcdn')) {
    headers.set('Referer', 'https://www.instagram.com/');
  } else if (host.includes('youtube') || host.includes('ytimg') || host.includes('googlevideo')) {
    headers.set('Referer', 'https://www.youtube.com/');
  }
  const range = incomingRequest.headers.get('Range');
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.set('Range', range);
  return headers;
}

function safeFilename(value) {
  const candidate = String(value || 'rexmedia-download').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 110);
  return candidate || 'rexmedia-download';
}

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    if (requestUrl.pathname === '/health') {
      return json({ ok: true, service: 'RexMedia public-content fetcher', allowList: [...ALLOWED_EXACT], note: 'No API keys or user credentials are used.' });
    }
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD, OPTIONS' });

    const targetRaw = requestUrl.searchParams.get('url');
    if (!targetRaw) return json({ error: 'Missing required query parameter: url', health: '/health' }, 400);

    let target;
    try { target = validateTarget(targetRaw); }
    catch (error) { return json({ error: error.message }, 400); }

    const download = requestUrl.searchParams.get('download') === '1';
    const filename = safeFilename(requestUrl.searchParams.get('filename'));
    let upstream;
    let upstreamUrl = target;

    try {
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
        upstream = await fetch(upstreamUrl.toString(), {
          method: request.method,
          headers: sourceHeaders(upstreamUrl, request),
          redirect: 'manual',
          signal: AbortSignal.timeout(25000),
        });
        if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
        const location = upstream.headers.get('Location');
        if (!location) break;
        if (redirects === MAX_REDIRECTS) return json({ error: 'The source returned too many redirects.' }, 502);
        const next = new URL(location, upstreamUrl);
        try { upstreamUrl = validateTarget(next.toString()); }
        catch (error) { return json({ error: 'The source redirected to a blocked hostname.' }, 502); }
      }
    } catch (error) {
      return json({ error: error && error.name === 'TimeoutError' ? 'The upstream source timed out.' : 'Unable to fetch the upstream source. The platform may be throttling requests.' }, 502);
    }

    if (download && (upstream.status < 200 || upstream.status >= 300)) {
      const failedStatus = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
      try { await upstream.body?.cancel(); } catch (_) {}
      return json({ error: 'The source did not return an available media file (HTTP ' + upstream.status + '). Choose another exposed thumbnail/media item or open the source directly.' }, failedStatus);
    }

    const contentType = upstream.headers.get('Content-Type') || 'application/octet-stream';
    if (download && !/^(image\/|video\/|audio\/|application\/octet-stream)/i.test(contentType)) {
      try { await upstream.body?.cancel(); } catch (_) {}
      return json({ error: 'The source did not return a direct media file. It may be a login page or blocked response.' }, 415);
    }

    const headers = new Headers(corsHeaders({
      'Content-Type': contentType,
    }));
    for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (download) headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    if (upstream.status === 206) headers.set('Accept-Ranges', 'bytes');

    // Do not forward Set-Cookie, CSP, server-identifying headers or upstream CORS policy.
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
