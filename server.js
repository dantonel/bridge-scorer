import { createClient } from 'redis';

let redis = null;
let connecting = false;

async function getRedisClient() {
  if (!redis) {
    if (connecting) {
      // Wait for existing connection attempt
      await new Promise(resolve => setTimeout(resolve, 100));
      return getRedisClient();
    }
    
    connecting = true;
    try {
      redis = createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: false
        }
      });
      
      redis.on('error', (err) => console.error('Redis Client Error', err));
      
      await redis.connect();
      connecting = false;
    } catch (error) {
      connecting = false;
      console.error('Failed to connect to Redis:', error);
      throw error;
    }
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    console.log(`${req.method} ${req.url}`);

    const client = await getRedisClient();
    const url = new URL(req.url, `https://${req.headers.host}`);
    
    // GET /api/games/:gameId
    if (req.method === 'GET' && url.pathname.startsWith('/api/games/')) {
      const gameId = url.pathname.split('/')[3];
      console.log('Getting game:', gameId);
      const gameJson = await client.get(`game:${gameId}`);
      
      if (gameJson) {
        const game = JSON.parse(gameJson);
        
        // Check if request has admin token
        const adminToken = req.headers['x-admin-token'] || url.searchParams.get('token');
        
        // If admin token provided, verify it
        if (adminToken) {
          if (game.adminToken !== adminToken) {
            sendJSON(res, 403, { error: 'Invalid admin token' });
            return;
          }
          // Valid admin token - return full game data
          sendJSON(res, 200, game);
        } else {
          // No admin token - return game data without admin token (normal player access)
          const { adminToken: _, ...gameWithoutToken } = game;
          sendJSON(res, 200, gameWithoutToken);
        }
      } else {
        sendJSON(res, 404, { error: 'Game not found' });
      }
      return;
    }

    // POST /api/games (create new game)
    if (req.method === 'POST' && url.pathname === '/api/games') {
      const gameData = req.body;
      console.log('Creating game:', gameData?.gameId);
      
      if (!gameData || !gameData.gameId) {
        sendJSON(res, 400, { error: 'Invalid request body - missing gameId' });
        return;
      }
      
      await client.set(`game:${gameData.gameId}`, JSON.stringify(gameData), {
        EX: 86400 // Expire after 24 hours
      });
      console.log('Game created successfully:', gameData.gameId);
      sendJSON(res, 201, gameData);
      return;
    }

    // PATCH /api/games/:gameId (partial update - merge changes)
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/games/')) {
      const gameId = url.pathname.split('/')[3];
      const updates = req.body;
      console.log('Updating game:', gameId);
      
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
      
      // Check if this is an admin operation (modifying scores for management)
      // Admin operations need the admin token
      const adminToken = req.headers['x-admin-token'];
      const isAdminUpdate = updates.tables && Object.keys(updates.tables).some(tableNum => {
        return updates.tables[tableNum]?.scores;
      });
      
      // If updating scores without being a locked player, require admin token
      if (isAdminUpdate) {
        // Check if the update is from a properly locked table
        const updatingTableNum = Object.keys(updates.tables)[0];
        const updatingTable = updates.tables[updatingTableNum];
        const existingTableSession = existingGame.tables?.[updatingTableNum]?.sessionId;
        
        // If table has a sessionId and update doesn't match, or update has no sessionId, need admin token
        if (existingTableSession && (!updatingTable?.sessionId || updatingTable.sessionId !== existingTableSession)) {
          if (!adminToken || existingGame.adminToken !== adminToken) {
            sendJSON(res, 403, { error: 'Admin token required for this operation' });
            return;
          }
        }
      }
      
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
      console.log('Replacing game:', gameId);
      
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
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message,
      hasRedisUrl: !!process.env.REDIS_URL
    });
  }
}