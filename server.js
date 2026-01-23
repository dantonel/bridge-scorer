import { createClient } from 'redis';

let redis = null;
let connecting = false;

async function getRedisClient() {
  if (!redis) {
    if (connecting) {
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

function sendJSON(res, statusCode, data) {
  res.status(statusCode).json(data);
}

function deepMerge(target, source) {
  const output = { ...target };
  
  function isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
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

export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token, X-Session-Id');

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    console.log(`${req.method} ${req.url}`);

    const client = await getRedisClient();
    const url = new URL(req.url, `https://${req.headers.host}`);
    
    // GET /api/version - Return build info
    if (req.method === 'GET' && url.pathname === '/api/version') {
      sendJSON(res, 200, {
        buildId: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
        deploymentUrl: process.env.VERCEL_URL || 'localhost',
        environment: process.env.VERCEL_ENV || 'development',
        gitBranch: process.env.VERCEL_GIT_COMMIT_REF || 'local'
      });
      return;
    }
    
    // GET /api/games/:gameId
    if (req.method === 'GET' && url.pathname.startsWith('/api/games/')) {
      const gameId = url.pathname.split('/')[3];
      console.log('Getting game:', gameId);
      const gameJson = await client.get(`game:${gameId}`);
      
      if (gameJson) {
        const game = JSON.parse(gameJson);
        const adminToken = req.headers['x-admin-token'] || url.searchParams.get('token');
        const tableNumber = req.headers['x-table-number'] || url.searchParams.get('table');
        const requestManagement = url.searchParams.get('management') === 'true';
        const managementSessionId = req.headers['x-management-session-id'];
        
        if (adminToken) {
          if (game.adminToken !== adminToken) {
            sendJSON(res, 403, { error: 'Invalid admin token' });
            return;
          }
          // Admin gets full game data
          sendJSON(res, 200, game);
        } else if (requestManagement) {
          // Trying to access management - check if it's locked
          console.log('Management access check:', {
            currentLock: game.managementSessionId,
            requestingSession: managementSessionId,
            isLocked: !!(game.managementSessionId && game.managementSessionId !== managementSessionId)
          });
          
          if (game.managementSessionId && game.managementSessionId !== managementSessionId) {
            sendJSON(res, 423, { error: 'Game management is currently in use by another session' });
            return;
          }
          // Management is available or already owned by this session
          const { adminToken: _, ...gameWithoutToken } = game;
          sendJSON(res, 200, gameWithoutToken);
        } else {
          // Non-admin: filter out current round scores from OTHER table
          const filteredGame = { ...game };
          delete filteredGame.adminToken;
          
          // If tableNumber is provided, hide current round score VALUES from the OTHER table
          // but keep the fact that scores EXIST for round completion detection
          if (tableNumber && game.tables) {
            const otherTable = tableNumber === '1' ? '2' : '1';
            const currentRound = game.currentRound;
            
            if (filteredGame.tables[otherTable]?.scores?.[currentRound]) {
              // Clone the game to avoid modifying the original
              filteredGame.tables = JSON.parse(JSON.stringify(game.tables));
              
              // Replace score values with placeholder to hide details but preserve existence
              const otherTableScores = filteredGame.tables[otherTable].scores[currentRound];
              for (const boardNum in otherTableScores) {
                // Keep minimal info - just that the score exists
                filteredGame.tables[otherTable].scores[currentRound][boardNum] = {
                  hidden: true,
                  board: otherTableScores[boardNum].board
                };
              }
            }
          }
          
          sendJSON(res, 200, filteredGame);
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
        EX: 86400
      });
      console.log('Game created successfully:', gameData.gameId);
      sendJSON(res, 201, gameData);
      return;
    }

    // PATCH /api/games/:gameId (partial update)
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
      
      // Check authorization for different types of updates
      const adminToken = req.headers['x-admin-token'];
      const sessionId = req.headers['x-session-id'];
      
      // Check if advancing round (updating currentRound)
      if (updates.hasOwnProperty('currentRound')) {
        // Require either: admin token OR valid player sessionId (from either table)
        if (adminToken) {
          if (existingGame.adminToken !== adminToken) {
            sendJSON(res, 403, { error: 'Invalid admin token' });
            return;
          }
        } else if (sessionId) {
          // Check if sessionId matches either table
          const table1Match = existingGame.tables?.[1]?.sessionId === sessionId;
          const table2Match = existingGame.tables?.[2]?.sessionId === sessionId;
          if (!table1Match && !table2Match) {
            sendJSON(res, 403, { error: 'Not authorized to advance round - must be a player in this game' });
            return;
          }
        } else {
          sendJSON(res, 403, { error: 'Authorization required to advance round' });
          return;
        }
      }
      
      // Check if updating table data
      if (updates.tables) {
        for (const tableNum of Object.keys(updates.tables)) {
          const tableUpdate = updates.tables[tableNum];
          const existingTable = existingGame.tables?.[tableNum];
          
          // Check if trying to clear sessionId (logout)
          if (tableUpdate.hasOwnProperty('sessionId') && tableUpdate.sessionId === null) {
            // Allow if: has admin token OR has matching sessionId in header
            if (adminToken) {
              if (existingGame.adminToken !== adminToken) {
                sendJSON(res, 403, { error: 'Invalid admin token' });
                return;
              }
            } else if (sessionId) {
              if (existingTable?.sessionId !== sessionId) {
                sendJSON(res, 403, { error: 'Invalid session - cannot unlock this table' });
                return;
              }
            } else {
              sendJSON(res, 403, { error: 'Authorization required to unlock table' });
              return;
            }
          }
          
          // Check if updating scores
          if (tableUpdate.scores) {
            const existingTableSession = existingTable?.sessionId;
            
            // Allow if: admin token OR matching sessionId in update body
            if (existingTableSession && existingTableSession !== tableUpdate.sessionId) {
              if (!adminToken || existingGame.adminToken !== adminToken) {
                sendJSON(res, 403, { error: 'Not authorized to update this table' });
                return;
              }
            }
          }
        }
      }
      
      // Check if acquiring/releasing management lock
      if (updates.hasOwnProperty('managementSessionId')) {
        const currentLock = existingGame.managementSessionId;
        const requestedSessionId = updates.managementSessionId;
        
        console.log('Management lock update:', {
          currentLock,
          requestedSessionId,
          sessionIdHeader: sessionId
        });
        
        // Releasing lock (null)
        if (requestedSessionId === null) {
          // Allow if: has admin token OR has matching managementSessionId
          if (adminToken) {
            if (existingGame.adminToken !== adminToken) {
              sendJSON(res, 403, { error: 'Invalid admin token' });
              return;
            }
          } else if (sessionId !== currentLock) {
            sendJSON(res, 403, { error: 'Cannot release management lock - not your session' });
            return;
          }
        } 
        // Acquiring lock
        else if (currentLock && currentLock !== requestedSessionId) {
          console.log('Lock denied - already locked by different session');
          sendJSON(res, 423, { error: 'Management is locked by another session' });
          return;
        }
        
        console.log('Lock operation allowed');
      }
      
      // All checks passed, perform the update
      const updatedGame = deepMerge(existingGame, updates);
      await client.set(`game:${gameId}`, JSON.stringify(updatedGame), {
        EX: 86400
      });
      sendJSON(res, 200, updatedGame);
      return;
    }

    // PUT /api/games/:gameId
    if (req.method === 'PUT' && url.pathname.startsWith('/api/games/')) {
      const gameId = url.pathname.split('/')[3];
      const gameData = req.body;
      console.log('Replacing game:', gameId);
      
      if (!gameData) {
        sendJSON(res, 400, { error: 'Invalid request body' });
        return;
      }
      
      // Check if all boards for current round are complete on both tables
      const currentRound = gameData.currentRound;
      const boardsPerRound = gameData.boardsPerRound || 4;
      
      if (currentRound <= 7) { // Only auto-advance up to round 7
        const table1Scores = gameData.tables?.[1]?.scores?.[currentRound] || {};
        const table2Scores = gameData.tables?.[2]?.scores?.[currentRound] || {};
        
        let allScoresComplete = true;
        for (let i = 1; i <= boardsPerRound; i++) {
          const boardNum = (currentRound - 1) * boardsPerRound + i;
          if (!table1Scores[boardNum] || !table2Scores[boardNum]) {
            allScoresComplete = false;
            break;
          }
        }
        
        // If all scores are in, automatically advance to next round
        if (allScoresComplete && currentRound < 7) {
          console.log(`All scores complete for round ${currentRound}, advancing to round ${currentRound + 1}`);
          gameData.currentRound = currentRound + 1;
        }
      }
      
      await client.set(`game:${gameId}`, JSON.stringify(gameData), {
        EX: 86400
      });
      sendJSON(res, 200, gameData);
      return;
    }

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
