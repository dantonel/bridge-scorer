import { getRedisClient } from '../lib/redis.js';

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

export async function getVersion(req, res) {
  sendJSON(res, 200, {
    buildId: process.env.GIT_COMMIT_SHA || 'dev',
    deploymentUrl: process.env.APP_URL || 'localhost',
    environment: process.env.NODE_ENV || 'development',
    gitBranch: process.env.GIT_BRANCH || 'local'
  });
}

export async function getGame(req, res) {
  const gameId = req.url.split('/')[3].split('?')[0];
  console.log('Getting game:', gameId);

  const client = await getRedisClient();
  const gameJson = await client.get(`game:${gameId}`);

  if (!gameJson) {
    sendJSON(res, 404, { error: 'Game not found' });
    return;
  }

  const game = JSON.parse(gameJson);
  const url = new URL(req.url, `https://${req.headers.host}`);
  const tableNumber = req.headers['x-table-number'] || url.searchParams.get('table');
  const requestManagement = url.searchParams.get('management') === 'true';
  const managementSessionId = req.headers['x-management-session-id'];

  if (requestManagement) {
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
    sendJSON(res, 200, game);
  } else {
    // Non-management: filter out current round scores from OTHER table
    const filteredGame = { ...game };

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
}

export async function createGame(req, res) {
  const gameData = req.body;
  console.log('Creating game:', gameData?.gameId);

  if (!gameData || !gameData.gameId) {
    sendJSON(res, 400, { error: 'Invalid request body - missing gameId' });
    return;
  }

  const client = await getRedisClient();
  await client.set(`game:${gameData.gameId}`, JSON.stringify(gameData), {
    EX: 86400
  });
  console.log('Game created successfully:', gameData.gameId);
  sendJSON(res, 201, gameData);
}

export async function patchGame(req, res) {
  const gameId = req.url.split('/')[3];
  const updates = req.body;
  console.log('Updating game:', gameId);

  if (!updates) {
    sendJSON(res, 400, { error: 'Invalid request body' });
    return;
  }

  const client = await getRedisClient();
  const existingJson = await client.get(`game:${gameId}`);

  if (!existingJson) {
    sendJSON(res, 404, { error: 'Game not found' });
    return;
  }

  const existingGame = JSON.parse(existingJson);

  // Check authorization for different types of updates
  const sessionId = req.headers['x-session-id'];

  // Check if advancing round (updating currentRound)
  if (updates.hasOwnProperty('currentRound')) {
    // Require valid player sessionId (from either table) OR management session
    if (sessionId) {
      // Check if sessionId matches either table OR management session
      const table1Match = existingGame.tables?.[1]?.sessionId === sessionId;
      const table2Match = existingGame.tables?.[2]?.sessionId === sessionId;
      const managementMatch = existingGame.managementSessionId === sessionId;

      if (!table1Match && !table2Match && !managementMatch) {
        sendJSON(res, 403, { error: 'Not authorized to advance round - must be a player or manager in this game' });
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
        // Allow if: has matching sessionId in header OR has management session
        const hasTableSession = sessionId && existingTable?.sessionId === sessionId;
        const hasManagementSession = existingGame.managementSessionId && existingGame.managementSessionId === sessionId;

        if (!hasTableSession && !hasManagementSession) {
          sendJSON(res, 403, { error: 'Invalid session - cannot unlock this table' });
          return;
        }
      }

      // Check if updating scores
      if (tableUpdate.scores) {
        const existingTableSession = existingTable?.sessionId;

        console.log('Score update authorization check:', {
          tableNumber: tableNum,
          existingTableSession,
          tableUpdateSessionId: tableUpdate.sessionId,
          hasManagementSession: !!(existingGame.managementSessionId && existingGame.managementSessionId === sessionId),
          managementSessionId: existingGame.managementSessionId,
          requestSessionId: sessionId
        });

        // Allow if: matching sessionId in update body OR management session
        if (existingTableSession && existingTableSession !== tableUpdate.sessionId) {
          const hasManagementSession = existingGame.managementSessionId && existingGame.managementSessionId === sessionId;

          if (!hasManagementSession) {
            console.log('Score update DENIED - no authorization');
            sendJSON(res, 403, { error: 'Not authorized to update this table' });
            return;
          }
          console.log('Score update ALLOWED - authorized via management session');
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
      // Allow if: has matching managementSessionId
      if (sessionId !== currentLock) {
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

  // Check if we should auto-advance the round (after scores are updated)
  const currentRound = updatedGame.currentRound;
  const boardsPerRound = updatedGame.boardsPerRound || 4;

  if (currentRound <= 7) { // Only auto-advance up to round 7
    const table1Scores = updatedGame.tables?.[1]?.scores?.[currentRound] || {};
    const table2Scores = updatedGame.tables?.[2]?.scores?.[currentRound] || {};

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
      console.log(`[PATCH] All scores complete for round ${currentRound}, advancing to round ${currentRound + 1}`);
      updatedGame.currentRound = currentRound + 1;
    }
  }

  await client.set(`game:${gameId}`, JSON.stringify(updatedGame), {
    EX: 86400
  });
  sendJSON(res, 200, updatedGame);
}

export async function putGame(req, res) {
  const gameId = req.url.split('/')[3];
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

  const client = await getRedisClient();
  await client.set(`game:${gameId}`, JSON.stringify(gameData), {
    EX: 86400
  });
  sendJSON(res, 200, gameData);
}
