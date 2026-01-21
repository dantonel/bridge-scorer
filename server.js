import { kv } from '@vercel/kv';

// Helper function to send JSON response
function sendJSON(res, statusCode, data) {
  res.status(statusCode).json(data);
}

// Deep merge helper to merge nested objects
// null values in source are treated as deletions
function deepMerge(target, source) {
  const output = { ...target };
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      // If source value is null, delete the key
      if (source[key] === null) {
        delete output[key];
      } else if (isObject(source[key])) {
        if (!(key in target)) {
          output[key] = source[key];
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        output[key] = source[key];
      }
    });
  }
  
  return output;
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

// Serverless function handler for Vercel
export default async (req, res) => {
  try {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    const url = new URL(req.url, `https://${req.headers.host}`);
    
    // GET /api/games/:gameId
    if (req.method === 'GET' && url.pathname.startsWith('/api/games/')) {
      const gameId = url.pathname.split('/')[3];
      const game = await kv.get(`game:${gameId}`);
      
      if (game) {
        sendJSON(res, 200, game);
      } else {
        sendJSON(res, 404, { error: 'Game not found' });
      }
      return;
    }

    // POST /api/games (create new game)
    if (req.method === 'POST' && url.pathname === '/api/games') {
      const gameData = req.body;
      
      if (!gameData || !gameData.gameId) {
        sendJSON(res, 400, { error: 'Invalid request body - missing gameId' });
        return;
      }
      
      await kv.set(`game:${gameData.gameId}`, gameData);
      // Set expiration to 24 hours (86400 seconds)
      await kv.expire(`game:${gameData.gameId}`, 86400);
      sendJSON(res, 201, gameData);
      return;
    }

    // PATCH /api/games/:gameId (partial update - merge changes)
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/games/')) {
      const gameId = url.pathname.split('/')[3];
      const updates = req.body;
      
      if (!updates) {
        sendJSON(res, 400, { error: 'Invalid request body' });
        return;
      }
      
      const existingGame = await kv.get(`game:${gameId}`);
      
      if (!existingGame) {
        sendJSON(res, 404, { error: 'Game not found' });
        return;
      }
      
      // Deep merge the updates into existing game
      const updatedGame = deepMerge(existingGame, updates);
      await kv.set(`game:${gameId}`, updatedGame);
      // Refresh expiration to 24 hours
      await kv.expire(`game:${gameId}`, 86400);
      sendJSON(res, 200, updatedGame);
      return;
    }

    // PUT /api/games/:gameId (full replace - for backward compatibility)
    if (req.method === 'PUT' && url.pathname.startsWith('/api/games/')) {
      const gameId = url.pathname.split('/')[3];
      const gameData = req.body;
      
      if (!gameData) {
        sendJSON(res, 400, { error: 'Invalid request body' });
        return;
      }
      
      await kv.set(`game:${gameId}`, gameData);
      // Refresh expiration to 24 hours
      await kv.expire(`game:${gameId}`, 86400);
      sendJSON(res, 200, gameData);
      return;
    }

    // 404 for other routes
    res.status(404).json({ error: 'Not Found' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};