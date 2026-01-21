import { createClient } from 'redis';

let redis = null;

async function getRedisClient() {
  if (!redis) {
    redis = createClient({
      url: process.env.REDIS_URL
    });
    
    redis.on('error', (err) => console.error('Redis Client Error', err));
    
    await redis.connect();
  }
  return redis;
}

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
export default async function handler(req, res) {
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

    const client = await getRedisClient();
    const url = new URL(req.url, `https://${req.headers.host}`);
    
    // GET /api/games/:gameId
    if (req.method === 'GET' && url.pathname.startsWith('/api/games/')) {
      const gameId = url.pathname.split('/')[3];
      const gameJson = await client.get(`game:${gameId}`);
      
      if (gameJson) {
        const game = JSON.parse(gameJson);
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
      
      await client.set(`game:${gameData.gameId}`, JSON.stringify(gameData), {
        EX: 86400 // Expire after 24 hours
      });
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
      
      const existingJson = await client.get(`game:${gameId}`);
      
      if (!existingJson) {
        sendJSON(res, 404, { error: 'Game not found' });
        return;
      }
      
      const existingGame = JSON.parse(existingJson);
      
      // Deep merge the updates into existing game
      const updatedGame = deepMerge(existingGame, updates);
      await client.set(`game:${gameId}`, JSON.stringify(updatedGame), {
        EX: 86400 // Refresh expiration to 24 hours
      });
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
      
      await client.set(`game:${gameId}`, JSON.stringify(gameData), {
        EX: 86400 // Refresh expiration to 24 hours
      });
      sendJSON(res, 200, gameData);
      return;
    }

    // 404 for other routes
    res.status(404).json({ error: 'Not Found' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message
    });
  }
}
