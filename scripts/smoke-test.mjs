import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const originalFetch = globalThis.fetch;
try {
  // Public health endpoint needs no upstream request.
  let response = await worker.fetch(new Request('https://worker.example/health'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);

  // Missing URLs and non-allow-listed targets are rejected before fetching.
  response = await worker.fetch(new Request('https://worker.example/'));
  assert.equal(response.status, 400);
  response = await worker.fetch(new Request('https://worker.example/?url=' + encodeURIComponent('https://example.com/')));
  assert.equal(response.status, 400);

  // An allow-listed public text fetch passes through with CORS.
  globalThis.fetch = async () => new Response('<html><body>public test page with enough text</body></html>', {
    status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
  response = await worker.fetch(new Request('https://worker.example/?url=' + encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ')));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(await response.text(), /public test page/);

  // Redirects are revalidated so a platform URL cannot turn the Worker into an open proxy.
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } });
  response = await worker.fetch(new Request('https://worker.example/?url=' + encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ')));
  assert.equal(response.status, 502);

  // Failed image responses must not be saved as if they were valid media.
  globalThis.fetch = async () => new Response('not found', {
    status: 404, headers: { 'Content-Type': 'image/jpeg' }
  });
  response = await worker.fetch(new Request('https://worker.example/?url=' + encodeURIComponent('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg') + '&download=1'));
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /not return an available media file/i);

  // A download query must return media rather than an HTML challenge/login page.
  globalThis.fetch = async () => new Response('<html>login required</html>', {
    status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
  response = await worker.fetch(new Request('https://worker.example/?url=' + encodeURIComponent('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg') + '&download=1'));
  assert.equal(response.status, 415);

  // Direct media downloads set a safe attachment filename.
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), {
    status: 200, headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '3' }
  });
  response = await worker.fetch(new Request('https://worker.example/?url=' + encodeURIComponent('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg') + '&download=1&filename=test-thumb.jpg'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="test-thumb.jpg"');
  assert.equal((await response.arrayBuffer()).byteLength, 3);

  console.log('RexMedia smoke tests passed.');
} finally {
  globalThis.fetch = originalFetch;
}
