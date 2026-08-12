// Optional future storefront endpoint.
// Hanya mengekspos action getStorefrontProducts; tidak menerima action admin dari browser publik.
const FALLBACK_GAS_URL = 'https://script.google.com/macros/s/AKfycbwCrRAnp6920pPEKFW4zmqfNaTNYnOx8XA0yWTyw1Tv3Dp0lK1txWy-cNWjJ6jjXndoqw/exec';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ status: 'error', message: 'Method tidak didukung' });
  }

  const gasUrl = process.env.GAS_URL || FALLBACK_GAS_URL;
  if (!gasUrl || !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(gasUrl)) {
    return res.status(500).json({ status: 'error', message: 'GAS_URL tidak valid.' });
  }

  try {
    const upstream = await fetch(gasUrl, {
      method: 'POST',
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getStorefrontProducts' })
    });
    const raw = await upstream.text();
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (_) { return res.status(502).json({ status: 'error', message: 'Storefront backend tidak mengembalikan JSON.' }); }
    return res.status(upstream.ok ? 200 : 502).json(parsed);
  } catch (err) {
    return res.status(502).json({ status: 'error', message: 'Storefront proxy gagal: ' + (err?.message || String(err)) });
  }
}
