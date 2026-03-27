import { setCorsHeaders } from './middleware/cors.js';
import { getVersion, getGame, createGame, patchGame, putGame } from './routes/games.js';

export async function handler(req, res) {
  try {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    console.log(`${req.method} ${req.url}`);

    const url = new URL(req.url, `https://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/version') return getVersion(req, res);
    if (req.method === 'GET' && url.pathname.startsWith('/api/games/')) return getGame(req, res);
    if (req.method === 'POST' && url.pathname === '/api/games') return createGame(req, res);
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/games/')) return patchGame(req, res);
    if (req.method === 'PUT' && url.pathname.startsWith('/api/games/')) return putGame(req, res);

    res.status(404).json({ error: 'Not Found' });
  } catch (error) {
    console.error('Server error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message,
      hasRedisUrl: !!process.env.REDIS_URL
    });
  }
}

export default handler;
