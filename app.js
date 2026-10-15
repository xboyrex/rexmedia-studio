(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const cfg = window.REX_CONFIG || {};
  const workerBase = String(cfg.workerBaseUrl || '').trim().replace(/\/+$/, '');
  const HISTORY_KEY = 'rexmedia:history:v1';
  const THEME_KEY = 'rexmedia:theme:v1';
  const state = { platform: 'youtube', busy: false, history: loadHistory(), lastResult: null };

  const ICON = (name) => '<svg aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plainText = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const trunc = (value, max) => { const s = String(value || ''); return s.length > max ? s.slice(0, max - 1) + '…' : s; };

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2300);
  }

  function loadHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(value) ? value.slice(0, Number(cfg.historyLimit) || 8) : [];
    } catch (_) { return []; }
  }

  function saveHistory(item) {
    state.history = [item, ...state.history.filter((h) => h.url !== item.url)].slice(0, Number(cfg.historyLimit) || 8);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history)); } catch (_) { /* storage can be disabled */ }
    renderHistory();
  }

  function renderHistory() {
    const root = $('recent-list');
    if (!state.history.length) {
      root.innerHTML = '<div class="empty-history"><span class="empty-history-icon">' + ICON('clock') + '</span><div><strong>No recent links yet</strong><p>Run an extraction and the link will show up here.</p></div><span class="empty-label">WAITING FOR YOU</span></div>';
      return;
    }
    root.innerHTML = state.history.map((item) => {
      const platformIcon = item.platform === 'instagram' ? 'instagram' : 'youtube';
      const date = item.time ? new Date(item.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Saved in this browser';
      return '<div class="history-item"><span class="history-platform">' + ICON(platformIcon) + '</span><div><strong>' + escapeHtml(trunc(item.title || item.url, 90)) + '</strong><small>' + escapeHtml(date) + ' · ' + escapeHtml(item.url) + '</small></div><button class="small-button" type="button" data-history-url="' + escapeHtml(item.url) + '" data-history-platform="' + escapeHtml(item.platform) + '">Open link</button></div>';
    }).join('');
  }

  function workerUrl(targetUrl, options) {
    if (!workerBase) throw new Error('Worker URL is missing. Edit workerBaseUrl in config.js after deploying the Cloudflare Worker.');
    const endpoint = new URL(workerBase + '/');
    endpoint.searchParams.set('url', targetUrl);
    if (options && options.download) endpoint.searchParams.set('download', '1');
    if (options && options.filename) endpoint.searchParams.set('filename', String(options.filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 110));
    return endpoint.toString();
  }

  async function fetchPage(targetUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 28000);
    try {
      const response = await fetch(workerUrl(targetUrl), { method: 'GET', signal: controller.signal, headers: { 'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' } });
      const text = await response.text();
      if (!response.ok) {
        let detail = '';
        try { detail = JSON.parse(text).error || JSON.parse(text).message || ''; } catch (_) { detail = plainText(text).slice(0, 180); }
        throw new Error(detail || ('Source fetch failed (HTTP ' + response.status + ').'));
      }
      if (!text || text.length < 40) throw new Error('The source returned an empty page. Try a different public link.');
      return text;
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error('The request timed out. The platform may be throttling public page access.');
      if (err instanceof TypeError) throw new Error('Could not reach the Cloudflare Worker. Check the Worker URL in config.js and try again.');
      throw err;
    } finally { clearTimeout(timeout); }
  }

  function findJsonAfter(source, marker) {
    const index = source.indexOf(marker);
    if (index < 0) return null;
    const open = source.indexOf('{', index + marker.length);
    if (open < 0) return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else {
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(source.slice(open, i + 1)); } catch (_) { return null; }
          }
        }
      }
    }
    return null;
  }

  function eachDeep(root, visit, limit) {
    const max = limit || 180000;
    const stack = [root];
    const seen = new Set();
    let count = 0;
    while (stack.length && count < max) {
      const current = stack.pop();
      if (!current || typeof current !== 'object' || seen.has(current)) continue;
      seen.add(current); count++;
      visit(current);
      if (Array.isArray(current)) {
        for (let i = current.length - 1; i >= 0; i--) if (current[i] && typeof current[i] === 'object') stack.push(current[i]);
      } else {
        const keys = Object.keys(current);
        for (let i = keys.length - 1; i >= 0; i--) {
          const v = current[keys[i]];
          if (v && typeof v === 'object') stack.push(v);
        }
      }
    }
  }

  function textFromNode(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(textFromNode).join('');
    if (typeof value !== 'object') return '';
    if (typeof value.simpleText === 'string') return value.simpleText;
    if (Array.isArray(value.runs)) return value.runs.map((r) => textFromNode(r && r.text)).join('');
    if (typeof value.text === 'string') return value.text;
    return '';
  }

  function parseCompactNumber(input) {
    const s = String(input || '').replace(/,/g, '').trim();
    const match = s.match(/(\d+(?:\.\d+)?)\s*([KMB])?/i);
    if (!match) return 0;
    const factor = ({ K: 1e3, M: 1e6, B: 1e9 })[(match[2] || '').toUpperCase()] || 1;
    return Math.round(Number(match[1]) * factor) || 0;
  }

  function extractHashtags(text) {
    const found = String(text || '').match(/#[\p{L}\p{N}_]+/gu) || [];
    return [...new Set(found)];
  }

  function parseYouTubeId(input) {
    let url;
    try { url = new URL(input); } catch (_) { return null; }
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
    if (url.pathname === '/watch') return url.searchParams.get('v');
    const segments = url.pathname.split('/').filter(Boolean);
    if (['shorts', 'embed', 'live', 'v'].includes(segments[0])) return segments[1] || null;
    return null;
  }

  function fmtNumber(value) {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat(undefined, { notation: Number(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(Number(value));
  }

  function extractYouTubeLikes(initial) {
    const candidates = [];
    eachDeep(initial, (node) => {
      if (node.segmentedLikeDislikeButtonViewModel || node.likeButtonViewModel || node.toggleButtonViewModel) {
        const block = JSON.stringify(node);
        const strings = block.match(/(?:accessibilityText|tooltip|title|text|label)\\?"\s*:\s*\\?"([^"\\]{1,100})/gi) || [];
        strings.forEach((v) => {
          const match = v.match(/([\d,.]+\s*[KMB]?)\s+likes?/i);
          if (match) candidates.push(parseCompactNumber(match[1]));
        });
      }
    }, 90000);
    return candidates.find((v) => v > 0) || null;
  }

  function extractYouTubeComments(initial) {
    const comments = [];
    eachDeep(initial, (node) => {
      const thread = node.commentThreadRenderer;
      const c = thread && thread.comment && thread.comment.commentRenderer;
      if (!c) return;
      const message = textFromNode(c.contentText).trim();
      if (!message) return;
      const likesText = textFromNode(c.voteCount) || '';
      comments.push({ author: textFromNode(c.authorText) || 'YouTube user', text: message, likes: parseCompactNumber(likesText), likesText });
    }, 160000);
    const seen = new Set();
    return comments.filter((c) => {
      const key = c.author + '|' + c.text;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a, b) => b.likes - a.likes).slice(0, 5);
  }

  async function extractYouTube(input) {
    const id = parseYouTubeId(input);
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
      throw new Error('Paste a valid YouTube video, Short, live, embed or youtu.be link.');
    }
    const canonical = 'https://www.youtube.com/watch?v=' + id + '&hl=en&gl=US';
    const html = await fetchPage(canonical);
    if (/consent\.youtube\.com|unusual traffic|captcha|verify you are human/i.test(html)) {
      throw new Error('YouTube returned a consent or anti-bot page. Try another public link or open the video on YouTube.');
    }

    const player = findJsonAfter(html, 'ytInitialPlayerResponse');
    const initial = findJsonAfter(html, 'ytInitialData');
    const details = (player && player.videoDetails) || {};
    const micro = player && player.microformat && player.microformat.playerMicroformatRenderer || {};
    const og = getOpenGraph(html);
    const rawTitle = details.title || textFromNode(micro.title) || og.title || '';
    const title = /^youtube(?:\s*-\s*youtube)?$/i.test(rawTitle.trim()) ? '' : rawTitle;
    const description = details.shortDescription || textFromNode(micro.description) || og.description || '';
    const author = details.author || micro.ownerChannelName || '';

    // A real metadata result must contain something obtained from the source;
    // don't present a constructed thumbnail as if extraction succeeded.
    if (!title && !description && !author) {
      throw new Error('YouTube did not expose readable title or description metadata. The page may be age-gated, restricted or blocked. Try another public video.');
    }

    const views = Number(details.viewCount || micro.viewCount || 0) || null;
    const duration = Number(details.lengthSeconds || 0) || null;
    const tags = Array.isArray(details.keywords) ? details.keywords.filter(Boolean) : [];
    const hashtags = extractHashtags(title + '\n' + description);
    const comments = initial ? extractYouTubeComments(initial) : [];
    const likes = initial ? extractYouTubeLikes(initial) : null;
    return {
      platform: 'youtube', id, url: 'https://www.youtube.com/watch?v=' + id,
      title, description, author, views, duration,
      tags, hashtags, comments, likes,
      thumbnails: [
        { label: 'Max · 1280×720', url: 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg', filename: 'rexmedia-' + id + '-maxres.jpg' },
        { label: 'SD · 640×480', url: 'https://i.ytimg.com/vi/' + id + '/sddefault.jpg', filename: 'rexmedia-' + id + '-sd.jpg' },
        { label: 'HQ · 480×360', url: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', filename: 'rexmedia-' + id + '-hq.jpg' },
        { label: 'MQ · 320×180', url: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg', filename: 'rexmedia-' + id + '-mq.jpg' }
      ],
      cover: og.image && isAllowedPublicMediaUrl(og.image) ? og.image : 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
      metadataSource: player ? 'YouTube player metadata' : 'Open Graph metadata fallback'
    };
  }

  function shortcodeToMediaId(code) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let value = 0n;
    for (const char of code) {
      const digit = alphabet.indexOf(char);
      if (digit < 0) return '';
      value = value * 64n + BigInt(digit);
    }
    return value.toString();
  }

  function parseInstagramUrl(input) {
    let url;
    try { url = new URL(input); } catch (_) { return null; }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['instagram.com', 'instagr.am'].includes(host)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (['p', 'reel', 'reels', 'tv'].includes(parts[0]) && /^[A-Za-z0-9_-]+$/.test(parts[1] || '')) {
      return { kind: 'post', code: parts[1], url: 'https://www.instagram.com/' + parts[0] + '/' + parts[1] + '/' };
    }
    if (parts[0] === 'stories' && parts.length >= 2) return { kind: 'story', url: 'https://www.instagram.com/' + parts.join('/') + '/' };
    return null;
  }

  function parseJsonScripts(html) {
    const roots = [];
    const scripts = html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of scripts) {
      const content = (match[1] || '').trim();
      if (!content || content.length < 20 || content.length > 16000000) continue;
      if (!/(?:video_versions|image_versions2|carousel_media|shortcode_media|if_not_gated_logged_out|xdt_shortcode_media|clips_metadata)/i.test(content) && !(/^[{[]/.test(content) && /"(?:@type|contentUrl|thumbnailUrl|caption|description)"/i.test(content))) continue;
      try { roots.push(JSON.parse(content)); } catch (_) {
        const start = content.indexOf('{');
        if (start >= 0) {
          let depth = 0, inString = false, escaped = false;
          for (let i = start; i < content.length; i++) {
            const ch = content[i];
            if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; }
            else if (ch === '"') inString = true;
            else if (ch === '{') depth++;
            else if (ch === '}' && --depth === 0) { try { roots.push(JSON.parse(content.slice(start, i + 1))); } catch (_) {} break; }
          }
        }
      }
    }
    for (const marker of ['window._sharedData', 'window.__additionalDataLoaded', 'xdt_api__v1__media__shortcode__web_info']) {
      const value = findJsonAfter(html, marker);
      if (value) roots.push(value);
    }
    return roots;
  }

  function isMediaProduct(obj) {
    return !!(obj && typeof obj === 'object' && (obj.video_versions || obj.image_versions2 || obj.carousel_media || obj.display_url) && (obj.pk || obj.id || obj.code || obj.shortcode));
  }

  function findInstagramProduct(roots, expectedId) {
    let fallback = null, match = null;
    for (const root of roots) {
      eachDeep(root, (node) => {
        if (node.if_not_gated_logged_out && isMediaProduct(node.if_not_gated_logged_out)) {
          const item = node.if_not_gated_logged_out;
          if (!fallback) fallback = item;
          if (!expectedId || String(item.pk || item.id || '') === String(expectedId)) match = item;
        }
        if (isMediaProduct(node)) {
          if (!fallback) fallback = node;
          if (expectedId && String(node.pk || node.id || '') === String(expectedId)) match = node;
          if (node.code && roots.length && !expectedId) match = node;
        }
      }, 200000);
      if (match) return match;
    }
    return match || fallback;
  }

  function firstCaption(product) {
    const c = product.caption;
    if (typeof c === 'string') return c;
    if (c && typeof c.text === 'string') return c.text;
    const edge = product.edge_media_to_caption && product.edge_media_to_caption.edges;
    if (Array.isArray(edge) && edge[0] && edge[0].node) return edge[0].node.text || '';
    return '';
  }

  function chooseImage(item) {
    const candidates = item && item.image_versions2 && item.image_versions2.candidates;
    if (Array.isArray(candidates) && candidates.length) return [...candidates].sort((a, b) => Number(b.width || 0) - Number(a.width || 0))[0].url || '';
    return (item && (item.display_url || item.thumbnail_src)) || '';
  }

  function extractMediaItem(item, index) {
    const versions = Array.isArray(item.video_versions) ? item.video_versions : [];
    const video = versions.length ? [...versions].sort((a, b) => Number(b.width || 0) - Number(a.width || 0))[0] : null;
    const cover = chooseImage(item) || (item.thumbnail_src || '');
    const url = video && video.url || chooseImage(item);
    if (!url) return null;
    const isVideo = !!video;
    const width = Number((video || {}).width || item.original_width || 0);
    const height = Number((video || {}).height || item.original_height || 0);
    return { url, isVideo, cover: cover || url, width, height, filename: 'rexmedia-instagram-' + (index + 1) + (isVideo ? '.mp4' : '.jpg') };
  }

  function extractAudioUrl(product) {
    let found = '';
    eachDeep(product, (node) => {
      if (found) return;
      for (const key of ['audio_download_url', 'audio_url', 'audioUrl', 'audio_playback_url', 'audio_source_url']) {
        const value = node[key];
        if (typeof value === 'string' && /^https:\/\//i.test(value)) { found = value; return; }
      }
    }, 50000);
    return found;
  }

  function extractInstagramComments(product) {
    const candidates = [];
    const pools = [
      product.edge_media_to_parent_comment && product.edge_media_to_parent_comment.edges,
      product.edge_media_to_comment && product.edge_media_to_comment.edges,
      product.preview_comments,
      product.comments && (product.comments.nodes || product.comments.edges)
    ].filter(Boolean);
    for (const pool of pools) {
      const list = Array.isArray(pool) ? pool : [];
      for (const entry of list) {
        const node = entry && (entry.node || entry.comment) || entry;
        if (!node || typeof node !== 'object') continue;
        const user = node.owner || node.user || {};
        const text = node.text || textFromNode(node.content_text || node.contentText);
        if (!text || !String(text).trim()) continue;
        const likes = Number((node.edge_liked_by && node.edge_liked_by.count) || (node.edge_liked_by && node.edge_liked_by.edges && node.edge_liked_by.edges.length) || node.like_count || 0) || 0;
        candidates.push({ author: user.username || user.full_name || node.username || 'Instagram user', text: String(text).trim(), likes });
      }
    }
    const seen = new Set();
    return candidates.filter((c) => { const key = c.author + '|' + c.text; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => b.likes - a.likes).slice(0, 5);
  }

  function getOpenGraph(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const get = (...names) => {
      for (const name of names) {
        const safe = name.replace(/"/g, '\\"');
        const node = doc.querySelector('meta[property="' + safe + '"],meta[name="' + safe + '"]');
        const value = node && node.getAttribute('content');
        if (value && value.trim()) return value.trim();
      }
      return '';
    };
    return {
      doc,
      title: get('og:title', 'twitter:title', 'title') || (doc.title || '').trim(),
      description: get('og:description', 'twitter:description', 'description'),
      image: get('og:image', 'og:image:secure_url', 'twitter:image'),
      video: get('og:video:secure_url', 'og:video', 'twitter:player:stream'),
      url: get('og:url')
    };
  }

  function isAllowedPublicMediaUrl(raw) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:') return false;
      const host = url.hostname.toLowerCase().replace(/\.$/, '');
      return host === 'ytimg.com' || host.endsWith('.ytimg.com') ||
        host === 'cdninstagram.com' || host.endsWith('.cdninstagram.com') ||
        host === 'fbcdn.net' || host.endsWith('.fbcdn.net') ||
        host === 'instagram.com' && /\/media\//i.test(url.pathname) ||
        host === 'instagr.am' && /\/media\//i.test(url.pathname);
    } catch (_) { return false; }
  }

  function firstTextFromDocument(doc, selectors) {
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      if (!node) continue;
      const value = (node.getAttribute('content') || node.getAttribute('alt') || node.textContent || '').replace(/\s+/g, ' ').trim();
      if (value && value.length > 1) return value;
    }
    return '';
  }

  function mediaFromEmbed(html, code, og) {
    const media = [];
    const add = (raw, isVideo, cover) => {
      if (typeof raw !== 'string' || !isAllowedPublicMediaUrl(raw)) return;
      if (media.some((item) => item.url === raw)) return;
      media.push({
        url: raw, isVideo: !!isVideo, cover: (cover && isAllowedPublicMediaUrl(cover)) ? cover : (isVideo ? '' : raw),
        width: 0, height: 0,
        filename: 'rexmedia-instagram-' + code + (isVideo ? '.mp4' : '.jpg')
      });
    };
    // Open Graph values are useful only when they point to actual public CDN/media URLs.
    add(og.video, true, og.image);
    add(og.image, false, og.image);

    const doc = og.doc;
    for (const node of doc.querySelectorAll('video[src], video source[src], source[src]')) {
      const src = node.getAttribute('src') || '';
      const type = (node.getAttribute('type') || '').toLowerCase();
      add(src, type.includes('video') || /\.(?:mp4|webm)(?:[?#]|$)/i.test(src), node.getAttribute('poster') || og.image);
    }
    for (const node of doc.querySelectorAll('img[src]')) {
      const src = node.getAttribute('src') || '';
      if (isAllowedPublicMediaUrl(src)) add(src, false, src);
    }

    // Some embed responses publish schema.org metadata without Instagram's internal JSON.
    const roots = parseJsonScripts(html);
    eachDeep(roots, (node) => {
      if (!node || typeof node !== 'object') return;
      const contentUrl = typeof node.contentUrl === 'string' ? node.contentUrl : '';
      const thumb = typeof node.thumbnailUrl === 'string' ? node.thumbnailUrl : Array.isArray(node.thumbnailUrl) ? node.thumbnailUrl[0] : '';
      const type = String(node['@type'] || node.type || '').toLowerCase();
      if (contentUrl) add(contentUrl, /video|clip|movie/.test(type) || /\.(?:mp4|webm)(?:[?#]|$)/i.test(contentUrl), thumb || og.image);
    }, 50000);

    return media;
  }

  async function extractInstagram(input) {
    const parsed = parseInstagramUrl(input);
    if (!parsed) throw new Error('Paste an Instagram public post, Reel, TV link or public story URL. Profile URLs are not supported.');

    let html = '';
    let primaryError = null;
    try { html = await fetchPage(parsed.url); } catch (error) { primaryError = error; }
    let og = getOpenGraph(html);
    const challenge = (source) => /login\/?\?next=|accounts\/login|please wait a few minutes|challenge_required|login to continue|\blogin required\b/i.test(source || '');

    if (parsed.kind === 'story') {
      const possible = [];
      const media = mediaFromEmbed(html, 'story', og);
      if (media.length) possible.push(...media);
      else if (og.video && isAllowedPublicMediaUrl(og.video)) possible.push({ url: og.video, isVideo: true, cover: og.image, filename: 'rexmedia-instagram-story.mp4' });
      else if (og.image && isAllowedPublicMediaUrl(og.image)) possible.push({ url: og.image, isVideo: false, cover: og.image, filename: 'rexmedia-instagram-story.jpg' });
      if (!possible.length) {
        if (primaryError) throw primaryError;
        if (challenge(html)) throw new Error('Instagram requires sign-in or returned a challenge. This tool will not bypass it.');
        throw new Error('This story did not expose a downloadable public media URL. Try a public post or Reel.');
      }
      return { platform: 'instagram', kind: 'story', url: parsed.url, title: og.title || 'Instagram story', author: '', caption: og.description || '', hashtags: extractHashtags(og.description || ''), tags: [], likes: null, comments: [], media: possible, cover: possible[0].cover || possible[0].url, audioUrl: '', audioTitle: '', note: 'Only media URLs exposed by the public story page are available.' };
    }

    const expectedId = shortcodeToMediaId(parsed.code);
    let product = html ? findInstagramProduct(parseJsonScripts(html), expectedId) : null;
    let media = [];
    const getProductMedia = (item) => {
      if (!item) return [];
      const carousel = Array.isArray(item.carousel_media) ? item.carousel_media : null;
      return (carousel || [item]).map((entry, index) => extractMediaItem(entry, index)).filter((entry) => entry && isAllowedPublicMediaUrl(entry.url));
    };
    if (product) media = getProductMedia(product);

    // Fallback: Instagram's public embed endpoint may expose different OG/schema metadata.
    // It is a fallback, not a guaranteed bypass; login/challenge pages are left blocked.
    let embedHtml = '';
    let embedOg = getOpenGraph('');
    let embedError = null;
    const baseCaption = product ? firstCaption(product) : '';
    if (!html || !product || !media.length || !baseCaption || !og.image) {
      const embedUrl = parsed.url.replace(/\/$/, '') + '/embed/captioned/';
      try {
        embedHtml = await fetchPage(embedUrl);
        embedOg = getOpenGraph(embedHtml);
      } catch (error) { embedError = error; }
      if (!product && embedHtml) {
        product = findInstagramProduct(parseJsonScripts(embedHtml), expectedId);
        if (product) media = getProductMedia(product);
      }
      if (!og.title && embedOg.title) og.title = embedOg.title;
      if (!og.description && embedOg.description) og.description = embedOg.description;
      if (!og.image && embedOg.image && isAllowedPublicMediaUrl(embedOg.image)) og.image = embedOg.image;
      if (!og.video && embedOg.video && isAllowedPublicMediaUrl(embedOg.video)) og.video = embedOg.video;
      if (!media.length && embedHtml) media = mediaFromEmbed(embedHtml, parsed.code, embedOg);
    }

    if (!html && !embedHtml) throw primaryError || embedError || new Error('Instagram public page could not be fetched. Try again later.');
    if (!product && !media.length && !og.image && !og.description && challenge(html + '\n' + embedHtml)) {
      throw new Error('Instagram requires sign-in or returned a challenge for this link. Private or login-gated media is not unlocked.');
    }

    const owner = product && (product.user || product.owner) || {};
    const structuredCaption = product ? firstCaption(product) : '';
    const embedCaption = embedHtml ? firstTextFromDocument(embedOg.doc, ['.Caption', '.caption', '.CaptionText', 'blockquote p', 'article h1', 'meta[name="description"]']) : '';
    const caption = structuredCaption || og.description || embedCaption || '';
    if (!media.length && og.video && isAllowedPublicMediaUrl(og.video)) media.push({ url: og.video, isVideo: true, cover: og.image || '', filename: 'rexmedia-instagram-' + parsed.code + '.mp4' });
    if (!media.length && og.image && isAllowedPublicMediaUrl(og.image)) media.push({ url: og.image, isVideo: false, cover: og.image, filename: 'rexmedia-instagram-' + parsed.code + '.jpg' });

    const clips = product && product.clips_metadata || {};
    const music = clips.music_info && clips.music_info.music_asset_info || clips.original_audio_info || clips.original_sound_info || {};
    const audioTitle = [music.display_artist || (music.ig_artist && music.ig_artist.username) || '', music.title || music.original_audio_title || ''].filter(Boolean).join(' · ');
    const audioUrl = product ? extractAudioUrl(product) : '';
    const cover = (media[0] && media[0].cover) || (og.image && isAllowedPublicMediaUrl(og.image) ? og.image : '') || '';
    const title = (owner.username ? '@' + owner.username : '') || og.title || 'Instagram post';
    const hasContent = !!(product || media.length || caption || og.title);
    if (!hasContent) {
      if (primaryError) throw primaryError;
      if (embedError) throw new Error('Instagram did not expose caption or downloadable media in either the post page or public embed. It may be login-gated.');
      throw new Error('Instagram returned a public page, but no caption or direct media URL could be extracted. Try another public Reel/post.');
    }

    return {
      platform: 'instagram', kind: 'post', code: parsed.code, url: parsed.url, title,
      author: owner.username || owner.full_name || '', caption, hashtags: extractHashtags(caption), tags: [],
      likes: product ? (Number((product.edge_media_preview_like && product.edge_media_preview_like.count) || product.like_count || 0) || null) : null,
      comments: product ? extractInstagramComments(product) : [], media, cover, audioUrl, audioTitle,
      note: media.length ? (product ? 'Direct media URLs were exposed by the public page.' : 'Only media exposed by the public page or embed is available; carousel items, comments and audio may be missing.') : 'Instagram did not expose a direct public media URL. Private or login-gated media is not unlocked.',
      sourceMode: product ? 'structured public page data' : 'Open Graph/embed fallback'
    };
  }

  function downloadHref(url, filename) {
    try { return workerUrl(url, { download: true, filename }); }
    catch (_) { return url; }
  }

  function imageHref(url) {
    try { return workerUrl(url); } catch (_) { return url; }
  }

  function copyButton(label, value, extraClass) {
    const text = String(value == null ? '' : value);
    const disabled = text.trim() ? '' : ' disabled title="No source text was exposed"';
    return '<button type="button" class="small-button ' + (extraClass || '') + '" data-copy="' + escapeHtml(text) + '"' + disabled + '>' + ICON('copy') + '<span>' + escapeHtml(label) + '</span></button>';
  }

  function resultCard(title, iconName, body, options) {
    const wide = options && options.wide ? ' wide' : '';
    return '<section class="result-card' + wide + '"><div class="result-card-header"><div class="result-card-title">' + ICON(iconName) + escapeHtml(title) + '</div>' + (options && options.action || '') + '</div><div class="result-card-body">' + body + '</div></section>';
  }

  function resultHeader(data) {
    const title = data.platform === 'youtube' ? data.title : data.title || 'Instagram media';
    const url = data.url || '';
    return '<div class="results-header"><div><h3>Extraction results</h3><p>' + escapeHtml(trunc(url, 125)) + '</p></div><div class="result-actions">' + copyButton('Copy link', url) + '<button type="button" class="small-button" data-open-url="' + escapeHtml(url) + '">' + ICON('external') + '<span>Open source</span></button></div></div>';
  }

  function summary(data) {
    const cover = data.cover ? '<img class="result-cover" src="' + escapeHtml(imageHref(data.cover)) + '" alt="Media preview" loading="lazy" referrerpolicy="no-referrer">' : '<div class="result-cover result-cover-placeholder">' + ICON(data.platform === 'instagram' ? 'instagram' : 'youtube') + '</div>';
    const meta = [];
    if (data.author) meta.push('<span class="meta-pill">' + escapeHtml(data.author) + '</span>');
    if (data.views != null) meta.push('<span class="meta-pill">' + ICON('youtube') + escapeHtml(fmtNumber(data.views)) + ' views</span>');
    if (data.likes != null) meta.push('<span class="meta-pill">' + ICON('heart') + escapeHtml(fmtNumber(data.likes)) + ' likes</span>');
    if (data.duration) meta.push('<span class="meta-pill">' + ICON('clock') + escapeHtml(formatDuration(data.duration)) + '</span>');
    if (data.media && data.media.length) meta.push('<span class="meta-pill">' + ICON('image') + escapeHtml(data.media.length) + ' media item' + (data.media.length > 1 ? 's' : '') + '</span>');
    const title = data.platform === 'instagram' && data.caption ? data.title + ' — ' + trunc(data.caption, 85) : (data.title || 'Title not exposed by the public page');
    const copy = data.platform === 'youtube' ? copyButton('Copy title', data.title) + copyButton('Copy description', data.description) : copyButton('Copy caption', data.caption) + copyButton('Copy hashtags', (data.hashtags || []).join(' '));
    return '<div class="result-summary">' + cover + '<div class="summary-content"><div class="summary-title">' + escapeHtml(trunc(title, 170)) + '</div><div class="summary-meta">' + meta.join('') + '</div><div class="summary-copy-actions">' + copy + '</div></div></div>';
  }

  function renderHashtags(data) {
    const all = data.hashtags || [];
    if (!all.length) return '<div class="empty-result">No hashtags were found in the visible title or description/caption.</div>';
    return '<div class="chip-list">' + all.map((tag) => '<span class="tag-chip hashtag">' + escapeHtml(tag) + '</span>').join('') + '</div><div style="margin-top:10px">' + copyButton('Copy hashtags', all.join(' ')) + '</div>';
  }

  function renderTags(data) {
    const tags = data.tags || [];
    if (!tags.length) return '<div class="empty-result">The public page did not expose YouTube creator tags. Hashtags are listed separately.</div>';
    return '<div class="chip-list">' + tags.map((tag) => '<span class="tag-chip">' + escapeHtml(tag) + '</span>').join('') + '</div><div style="margin-top:10px">' + copyButton('Copy creator tags', tags.join(', ')) + '</div>';
  }

  function renderThumbnails(data) {
    const thumbs = data.thumbnails || [];
    if (!thumbs.length) return '<div class="empty-result">No thumbnail variants found.</div>';
    const fallback = data.id ? imageHref('https://i.ytimg.com/vi/' + data.id + '/hqdefault.jpg') : '';
    return '<div class="thumbnail-grid">' + thumbs.map((t) => '<div class="thumbnail-option"><img src="' + escapeHtml(imageHref(t.url)) + '"' + (fallback ? ' onerror="this.onerror=null;this.src=&quot;' + escapeHtml(fallback) + '&quot;"' : '') + ' alt="' + escapeHtml(t.label) + '" loading="lazy" referrerpolicy="no-referrer"><div class="thumbnail-option-foot"><strong>' + escapeHtml(t.label) + '</strong><a class="small-button primary-mini" href="' + escapeHtml(downloadHref(t.url, t.filename)) + '">' + ICON('download') + '<span>Save</span></a></div></div>').join('') + '</div>';
  }

  function renderComments(data) {
    const comments = data.comments || [];
    if (!comments.length) return '<div class="empty-result">Top comments were not exposed in the public page response. This can happen even when the video is public.</div>';
    return comments.map((c) => '<div class="comment-item"><div class="comment-head"><span class="comment-avatar">' + escapeHtml((c.author || '?').charAt(0).toUpperCase()) + '</span><span class="comment-author">' + escapeHtml(c.author || 'User') + '</span><span class="like-count">' + ICON('heart') + escapeHtml(fmtNumber(c.likes || 0)) + '</span></div><div class="comment-body">' + escapeHtml(c.text) + '</div><div style="margin-top:7px">' + copyButton('Copy comment', c.text) + '</div></div>').join('');
  }

  function renderYouTube(data) {
    const description = data.description ? escapeHtml(data.description) : '<span class="empty-result">No description was exposed.</span>';
    const stats = '<div class="list-row"><div class="list-main"><span>' + ICON('youtube') + '</span><span><strong>Views</strong><small>Visible on the public watch page</small></span></div><span class="like-count">' + escapeHtml(fmtNumber(data.views)) + '</span></div>' +
      '<div class="list-row"><div class="list-main"><span>' + ICON('heart') + '</span><span><strong>Likes</strong><small>May be hidden by YouTube</small></span></div><span class="like-count">' + escapeHtml(data.likes == null ? 'Not exposed' : fmtNumber(data.likes)) + '</span></div>' +
      '<div class="list-row"><div class="list-main"><span>' + ICON('clock') + '</span><span><strong>Duration</strong><small>Video length</small></span></div><span class="like-count">' + escapeHtml(data.duration ? formatDuration(data.duration) : '—') + '</span></div>';
    const note = '<div class="notice-box">' + ICON('circle-alert') + '<span><strong>Public-page limits:</strong> YouTube may withhold creator tags, likes and comments. This tool saves exposed thumbnails and copies visible metadata; it does not extract video streams from YouTube. For videos you uploaded, use <a href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer">YouTube Studio</a>.</span></div>';
    return resultHeader(data) + summary(data) + '<div class="result-grid">' +
      resultCard('Description', 'copy', description, { wide: true, action: copyButton('Copy', data.description) }) +
      resultCard('Hashtags in title + description', 'hash', renderHashtags(data)) +
      resultCard('YouTube creator tags', 'hash', renderTags(data)) +
      resultCard('Video details', 'zap', stats) +
      resultCard('Thumbnail downloads', 'image', renderThumbnails(data), { wide: true }) +
      resultCard('Top 5 comments by visible likes', 'message', renderComments(data), { wide: true }) +
      resultCard('What to expect', 'shield', note, { wide: true }) + '</div>';
  }

  function renderInstagramMedia(data) {
    const items = data.media || [];
    if (!items.length) return '<div class="empty-result">No direct public media URL could be extracted from this post.</div>';
    return items.map((item, index) => {
      const name = item.filename || 'rexmedia-instagram-' + (index + 1) + (item.isVideo ? '.mp4' : '.jpg');
      const sub = (item.isVideo ? 'Video' : 'Image') + (item.width && item.height ? ' · ' + item.width + '×' + item.height : '');
      const image = item.cover ? '<img class="list-thumb" src="' + escapeHtml(imageHref(item.cover)) + '" loading="lazy" alt="Media preview" referrerpolicy="no-referrer">' : '<span class="list-thumb" style="display:grid;place-items:center">' + ICON(item.isVideo ? 'youtube' : 'image') + '</span>';
      return '<div class="list-row"><div class="list-main">' + image + '<span><strong>' + escapeHtml('Media item ' + (index + 1)) + '</strong><small>' + escapeHtml(sub) + '</small></span></div><div class="list-trailing"><a class="small-button primary-mini" href="' + escapeHtml(downloadHref(item.url, name)) + '">' + ICON('download') + '<span>Save</span></a></div></div>';
    }).join('');
  }

  function renderInstagramAudio(data) {
    if (data.audioUrl) {
      let extension = '';
      try { extension = (new URL(data.audioUrl).pathname.match(/\.(mp3|m4a|aac|ogg|webm)$/i) || [])[0] || ''; } catch (_) {}
      const safeFilename = 'rexmedia-audio-source' + extension;
      return '<div class="notice-box">' + ICON('music') + '<span><strong>Separate audio URL found.</strong> This saves the original source only; no conversion is performed.</span></div><div style="margin-top:10px"><a class="small-button primary-mini" href="' + escapeHtml(downloadHref(data.audioUrl, safeFilename)) + '">' + ICON('download') + '<span>Download audio source</span></a></div>';
    }
    return '<div class="notice-box">' + ICON('circle-alert') + '<span><strong>Audio-only source not exposed.</strong> Instagram usually serves a Reel as a video file, not a separate audio file. Because you asked for direct audio without conversion, this build will not rename an MP4 to MP3 or create a fake download.</span></div>' + (data.audioTitle ? '<div class="copy-text" style="margin-top:9px">Visible track details: ' + escapeHtml(data.audioTitle) + '</div>' : '');
  }

  function renderInstagram(data) {
    const caption = data.caption ? escapeHtml(data.caption) : '<span class="empty-result">No caption text was exposed.</span>';
    const comments = data.comments || [];
    const commentBody = comments.length ? renderComments(data) : '<div class="empty-result">Instagram comments and per-comment likes are often missing from public embed data.</div>';
    const captionTitle = data.kind === 'story' ? 'Story details' : 'Caption';
    const hashtagsTitle = data.kind === 'story' ? 'Hashtags in story text' : 'Hashtags in caption';
    const note = '<div class="notice-box">' + ICON('shield') + '<span>' + escapeHtml(data.note || 'Only content exposed by the public page is available.') + ' Private or login-gated media is not unlocked.</span></div>';
    return resultHeader(data) + summary(data) + '<div class="result-grid">' +
      resultCard(captionTitle, 'copy', '<div class="copy-text">' + caption + '</div>', { wide: true, action: copyButton('Copy', data.caption) }) +
      resultCard(hashtagsTitle, 'hash', renderHashtags(data)) +
      resultCard('Public media downloads', 'download', renderInstagramMedia(data), { wide: true }) +
      resultCard('Direct audio source', 'music', renderInstagramAudio(data), { wide: true }) +
      resultCard('Top visible comments', 'message', commentBody, { wide: true }) +
      resultCard('Public-content limits', 'shield', note, { wide: true }) + '</div>';
  }

  function formatDuration(seconds) {
    const value = Number(seconds) || 0;
    if (!value) return '—';
    const h = Math.floor(value / 3600), m = Math.floor((value % 3600) / 60), s = value % 60;
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0');
  }

  function renderError(error) {
    const message = error && error.message ? error.message : 'Something went wrong while reading this public page.';
    $('results-wrap').innerHTML = '<div class="error-result"><div class="error-heading">' + ICON('circle-alert') + '<div><strong>Could not extract this link</strong><p>' + escapeHtml(message) + '</p></div></div><div class="notice-box">' + ICON('shield') + '<span>Try a public, non-age-restricted link. Platform markup changes and anti-bot protections can temporarily break public-page parsing. The tool does not bypass sign-in, private accounts or content restrictions.</span></div></div>';
    $('results-wrap').hidden = false;
    $('results-wrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function runExtraction(input) {
    if (state.busy) return;
    const raw = String(input || '').trim();
    if (!raw) { $('url-input').focus(); toast('Paste a public link first'); return; }
    let url;
    try { url = new URL(raw); } catch (_) { renderError(new Error('Enter a complete URL beginning with https://')); return; }
    if (url.protocol !== 'https:') { renderError(new Error('Only HTTPS URLs are supported.')); return; }
    state.busy = true;
    $('extract-button').classList.add('loading');
    $('extract-button').disabled = true;
    $('extract-button').querySelector('.button-label').textContent = 'Reading public page…';
    $('results-wrap').hidden = false;
    $('results-wrap').innerHTML = '<div class="loading-result"><span class="loading-orbit"></span><div><strong>Reading the public page</strong><p>Fetching available metadata through your Cloudflare Worker…</p></div></div>';
    try {
      const data = state.platform === 'youtube' ? await extractYouTube(raw) : await extractInstagram(raw);
      state.lastResult = data;
      $('results-wrap').innerHTML = state.platform === 'youtube' ? renderYouTube(data) : renderInstagram(data);
      saveHistory({ platform: data.platform, url: data.url || raw, title: data.title || (data.author ? '@' + data.author : raw), time: Date.now() });
      $('results-wrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast(data.sourceMode ? 'Public data loaded (' + data.sourceMode + ')' : 'Public metadata loaded');
    } catch (error) {
      console.warn('[RexMedia] extraction did not complete:', error);
      renderError(error);
    } finally {
      state.busy = false;
      $('extract-button').classList.remove('loading');
      $('extract-button').disabled = false;
      $('extract-button').querySelector('.button-label').textContent = 'Extract details';
    }
  }

  function setPlatform(platform) {
    if (!['youtube', 'instagram'].includes(platform)) return;
    state.platform = platform;
    state.lastResult = null;
    const isYouTube = platform === 'youtube';
    document.querySelectorAll('.tool-tab').forEach((tab) => {
      const active = tab.dataset.platform === platform;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-nav]').forEach((link) => link.classList.toggle('active', link.dataset.nav === platform));
    const icon = $('tool-platform-icon');
    icon.className = 'tool-icon ' + (isYouTube ? 'youtube-icon' : 'instagram-icon');
    icon.innerHTML = ICON(isYouTube ? 'youtube' : 'instagram');
    $('tool-form-title').textContent = isYouTube ? 'YouTube metadata extractor' : 'Instagram media & caption extractor';
    $('tool-form-subtitle').textContent = isYouTube ? 'Pull title, description, creator tags, hashtags, comments and thumbnail options.' : 'Copy captions and hashtags, save public media and check whether a separate audio source is available.';
    $('url-input').placeholder = isYouTube ? 'Paste a YouTube video link here…' : 'Paste an Instagram post, Reel or public story link…';
    $('sample-link').textContent = 'Use a sample link';
    $('sample-link').hidden = !isYouTube;
    $('privacy-note').innerHTML = ICON('circle-alert') + '<span>' + (isYouTube ? 'Public page parsing can be blocked or change without notice. YouTube’s API isn’t used, so likes and comments appear only when available in the page source.' : 'Only public Instagram pages are attempted. Separate audio-only URLs and story/highlight media are not always exposed; no login, private-content bypass or media conversion is included.') + '</span>';
    if (!$('results-wrap').hidden) $('results-wrap').hidden = true;
    if ($('url-input').value) $('url-input').value = '';
    $('clear-url').hidden = true;
    $('url-input').focus({ preventScroll: true });
  }

  document.querySelectorAll('.tool-tab').forEach((tab) => tab.addEventListener('click', () => setPlatform(tab.dataset.platform)));
  document.querySelectorAll('[data-open-platform]').forEach((button) => button.addEventListener('click', () => { setPlatform(button.dataset.openPlatform); $('tool').scrollIntoView({ behavior: 'smooth' }); }));
  document.querySelectorAll('[data-nav]').forEach((link) => link.addEventListener('click', () => {
    if (link.dataset.nav === 'youtube' || link.dataset.nav === 'instagram') setPlatform(link.dataset.nav);
    document.querySelectorAll('[data-nav]').forEach((item) => item.classList.toggle('active', item === link));
    closeMobileNav();
  }));
  $('extract-form').addEventListener('submit', (event) => { event.preventDefault(); runExtraction($('url-input').value); });
  $('url-input').addEventListener('input', () => { $('clear-url').hidden = !$('url-input').value; });
  $('clear-url').addEventListener('click', () => { $('url-input').value = ''; $('clear-url').hidden = true; $('url-input').focus(); });
  $('sample-link').addEventListener('click', () => {
    if (state.platform === 'youtube') {
      $('url-input').value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      $('clear-url').hidden = false;
      toast('Sample link added — click Extract details');
    }
  });
  $('clear-history').addEventListener('click', () => {
    state.history = [];
    try { localStorage.removeItem(HISTORY_KEY); } catch (_) {}
    renderHistory(); toast('Local history cleared');
  });

  document.addEventListener('click', async (event) => {
    const copy = event.target.closest && event.target.closest('[data-copy]');
    if (copy) {
      const value = copy.getAttribute('data-copy') || '';
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
        else {
          const textarea = document.createElement('textarea'); textarea.value = value; textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.appendChild(textarea); textarea.select();
          if (!document.execCommand('copy')) throw new Error('copy failed');
          textarea.remove();
        }
        toast('Copied to clipboard');
      } catch (_) { toast('Clipboard unavailable in this browser'); }
      return;
    }
    const open = event.target.closest && event.target.closest('[data-open-url]');
    if (open) {
      const url = open.getAttribute('data-open-url');
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    const historyButton = event.target.closest && event.target.closest('[data-history-url]');
    if (historyButton) {
      setPlatform(historyButton.dataset.historyPlatform || 'youtube');
      $('url-input').value = historyButton.dataset.historyUrl || '';
      $('clear-url').hidden = !$('url-input').value;
      $('tool').scrollIntoView({ behavior: 'smooth' });
      runExtraction($('url-input').value);
    }
  });

  function closeMobileNav() {
    $('sidebar').classList.remove('mobile-open');
    $('mobile-overlay').classList.remove('show');
  }
  $('mobile-menu').addEventListener('click', () => { $('sidebar').classList.toggle('mobile-open'); $('mobile-overlay').classList.toggle('show'); });
  $('mobile-overlay').addEventListener('click', closeMobileNav);
  document.querySelectorAll('.theme-toggle').forEach((button) => button.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    try { localStorage.setItem(THEME_KEY, document.body.classList.contains('light-theme') ? 'light' : 'dark'); } catch (_) {}
  }));
  try { if (localStorage.getItem(THEME_KEY) === 'light') document.body.classList.add('light-theme'); } catch (_) {}
  renderHistory();

  // Quick health indicator in the console, without sending analytics or network pings.
  if (!workerBase) console.warn('[RexMedia] config.js has no workerBaseUrl. Set it after deploying worker/index.js.');
})();
