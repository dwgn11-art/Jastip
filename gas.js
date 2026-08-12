// Vercel Serverless Function: /api/gas
// Browser -> Vercel -> Google Apps Script.
// UI tidak lagi terkena masalah CORS/redirect GAS secara langsung.

const FALLBACK_GAS_URL = 'https://script.google.com/macros/s/AKfycbwCrRAnp6920pPEKFW4zmqfNaTNYnOx8XA0yWTyw1Tv3Dp0lK1txWy-cNWjJ6jjXndoqw/exec';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const gasUrl = process.env.GAS_URL || FALLBACK_GAS_URL;
  if (!gasUrl || !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(gasUrl)) {
    return res.status(500).json({
      status: 'error',
      message: 'GAS_URL tidak valid. Gunakan URL Web App Apps Script yang berakhiran /exec.'
    });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ status: 'error', message: 'Method tidak didukung' });
  }

  try {
    const options = {
      method: req.method,
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    };

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      options.body = body;
    }

    const upstream = await fetch(gasUrl, options);
    const raw = await upstream.text();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      const looksLikeGoogleLogin = /accounts\.google\.com|Sign in|Masuk/i.test(raw);
      return res.status(502).json({
        status: 'error',
        message: looksLikeGoogleLogin
          ? 'GAS meminta login Google. Deploy Web App dengan akses Anyone.'
          : 'GAS tidak mengembalikan JSON. Pastikan URL /exec dan deployment Web App sudah benar.',
        upstreamStatus: upstream.status
      });
    }

    // Apps Script sering berakhir HTTP 200 setelah redirect ContentService.
    return res.status(upstream.ok ? 200 : 502).json(parsed);
  } catch (err) {
    console.error('GAS proxy error:', err);
    return res.status(502).json({
      status: 'error',
      message: 'Proxy gagal menghubungi Google Apps Script: ' + (err?.message || String(err))
    });
  }
}
