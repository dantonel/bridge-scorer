import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { handler } from '../server.js';
import { getRedisClient } from '../lib/redis.js';

let baseUrl;
let server;
const createdGameIds = [];

function gameId() {
  const id = `test-${randomUUID().slice(0, 8)}`;
  createdGameIds.push(id);
  return id;
}

async function api(path, options = {}) {
  const { headers: extraHeaders, body, ...rest } = options;
  return fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    ...rest,
    body: body ? JSON.stringify(body) : undefined
  });
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.all('/api/*', handler);

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (createdGameIds.length > 0) {
    const client = await getRedisClient();
    for (const id of createdGameIds) {
      await client.del(`game:${id}`);
    }
  }
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /api/version', () => {
  test('returns version fields', async () => {
    const res = await api('/api/version');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok('buildId' in body);
    assert.ok('deploymentUrl' in body);
    assert.ok('environment' in body);
    assert.ok('gitBranch' in body);
  });
});

describe('POST /api/games', () => {
  test('creates a game and returns 201', async () => {
    const id = gameId();
    const res = await api('/api/games', {
      method: 'POST',
      body: { gameId: id, currentRound: 1, boardsPerRound: 4 }
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.gameId, id);
  });

  test('returns 400 when gameId is missing', async () => {
    const res = await api('/api/games', {
      method: 'POST',
      body: { currentRound: 1 }
    });
    assert.equal(res.status, 400);
  });
});

describe('GET /api/games/:id', () => {
  test('returns the game after creation', async () => {
    const id = gameId();
    await api('/api/games', {
      method: 'POST',
      body: { gameId: id, currentRound: 1 }
    });

    const res = await api(`/api/games/${id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.gameId, id);
    assert.equal(body.currentRound, 1);
  });

  test('returns 404 for unknown game', async () => {
    const res = await api('/api/games/does-not-exist-xyz');
    assert.equal(res.status, 404);
  });

  test('hides current-round scores from the other table', async () => {
    const id = gameId();
    // Create game with table 2 already having round 1 scores
    await api('/api/games', {
      method: 'POST',
      body: {
        gameId: id,
        currentRound: 1,
        boardsPerRound: 4,
        tables: {
          '1': { sessionId: 'session-t1' },
          '2': {
            sessionId: 'session-t2',
            scores: {
              '1': {
                '1': { board: 1, level: 3, strain: 'NT', double: '', declarer: 'north', tricksTaken: 9 }
              }
            }
          }
        }
      }
    });

    // Table 1 requests the game — should see table 2's round 1 scores hidden
    const res = await api(`/api/games/${id}`, {
      headers: { 'x-table-number': '1' }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const t2score = body.tables['2'].scores['1']['1'];
    assert.equal(t2score.hidden, true, 'Table 2 current-round scores should be hidden from table 1');
    assert.equal(t2score.board, 1, 'Board number should be preserved even when hidden');
    assert.ok(!('level' in t2score), 'Score details should not be visible');
  });

  test('management session sees full unfiltered game', async () => {
    const id = gameId();
    await api('/api/games', {
      method: 'POST',
      body: {
        gameId: id,
        currentRound: 1,
        boardsPerRound: 4,
        managementSessionId: 'mgmt-session',
        tables: {
          '2': {
            sessionId: 'session-t2',
            scores: {
              '1': {
                '1': { board: 1, level: 3, strain: 'NT', double: '', declarer: 'north', tricksTaken: 9 }
              }
            }
          }
        }
      }
    });

    // Management requests game — scores should NOT be hidden
    const res = await api(`/api/games/${id}?management=true`, {
      headers: { 'x-management-session-id': 'mgmt-session' }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const score = body.tables['2'].scores['1']['1'];
    assert.equal(score.hidden, undefined, 'Scores should not be hidden for management session');
    assert.equal(score.level, 3);
  });

  test('returns 423 when management is locked by another session', async () => {
    const id = gameId();
    await api('/api/games', {
      method: 'POST',
      body: { gameId: id, managementSessionId: 'session-A' }
    });

    const res = await api(`/api/games/${id}?management=true`, {
      headers: { 'x-management-session-id': 'session-B' }
    });
    assert.equal(res.status, 423);
  });
});

describe('PATCH /api/games/:id', () => {
  test('updates game data via deep merge', async () => {
    const id = gameId();
    await api('/api/games', {
      method: 'POST',
      body: { gameId: id, currentRound: 1, boardsPerRound: 4, someField: 'original' }
    });

    const res = await api(`/api/games/${id}`, {
      method: 'PATCH',
      body: { newField: 'added' }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.someField, 'original', 'Existing fields should be preserved');
    assert.equal(body.newField, 'added');
  });

  test('returns 404 for unknown game', async () => {
    const res = await api('/api/games/no-such-game', {
      method: 'PATCH',
      body: { someField: 'value' }
    });
    assert.equal(res.status, 404);
  });

  test('returns 403 when session is not authorized to update scores', async () => {
    const id = gameId();
    await api('/api/games', {
      method: 'POST',
      body: {
        gameId: id,
        currentRound: 1,
        boardsPerRound: 4,
        tables: { '1': { sessionId: 'correct-session' } }
      }
    });

    const res = await api(`/api/games/${id}`, {
      method: 'PATCH',
      body: {
        tables: {
          '1': {
            sessionId: 'wrong-session',
            scores: { '1': { '1': { board: 1 } } }
          }
        }
      }
    });
    assert.equal(res.status, 403);
  });

  test('management session can update any table scores', async () => {
    const id = gameId();
    await api('/api/games', {
      method: 'POST',
      body: {
        gameId: id,
        currentRound: 1,
        boardsPerRound: 4,
        managementSessionId: 'mgmt-session',
        tables: { '1': { sessionId: 'table-session' } }
      }
    });

    // Management updates table 1 scores without providing matching sessionId in body
    const res = await api(`/api/games/${id}`, {
      method: 'PATCH',
      headers: { 'x-session-id': 'mgmt-session' },
      body: {
        tables: {
          '1': {
            sessionId: 'wrong-session',
            scores: { '1': { '1': { board: 1, level: 1, strain: 'NT' } } }
          }
        }
      }
    });
    assert.equal(res.status, 200);
  });

  test('returns 403 when advancing round without valid session', async () => {
    const id = gameId();
    await api('/api/games', {
      method: 'POST',
      body: { gameId: id, currentRound: 1, tables: { '1': { sessionId: 'session-t1' } } }
    });

    const res = await api(`/api/games/${id}`, {
      method: 'PATCH',
      headers: { 'x-session-id': 'wrong-session' },
      body: { currentRound: 2 }
    });
    assert.equal(res.status, 403);
  });

  test('auto-advances currentRound when all boards are scored by both tables', async () => {
    const id = gameId();
    await api('/api/games', {
      method: 'POST',
      body: {
        gameId: id,
        currentRound: 1,
        boardsPerRound: 4,
        tables: {
          '1': { sessionId: 'session-t1' },
          '2': { sessionId: 'session-t2' }
        }
      }
    });

    const round1Scores = {
      '1': { board: 1, level: 3, strain: 'NT', double: '', declarer: 'north', tricksTaken: 9 },
      '2': { board: 2, level: 4, strain: 'S',  double: '', declarer: 'south', tricksTaken: 10 },
      '3': { board: 3, level: 2, strain: 'H',  double: '', declarer: 'east',  tricksTaken: 8 },
      '4': { board: 4, level: 3, strain: 'C',  double: '', declarer: 'west',  tricksTaken: 10 }
    };

    // Table 1 submits round 1 scores — should NOT auto-advance yet
    const afterTable1 = await api(`/api/games/${id}`, {
      method: 'PATCH',
      body: { tables: { '1': { sessionId: 'session-t1', scores: { '1': round1Scores } } } }
    });
    const game1 = await afterTable1.json();
    assert.equal(game1.currentRound, 1, 'Should not advance until table 2 also scores');

    // Table 2 submits round 1 scores — should auto-advance
    const afterTable2 = await api(`/api/games/${id}`, {
      method: 'PATCH',
      body: { tables: { '2': { sessionId: 'session-t2', scores: { '1': round1Scores } } } }
    });
    assert.equal(afterTable2.status, 200);
    const game2 = await afterTable2.json();
    assert.equal(game2.currentRound, 2, 'Should auto-advance to round 2 when both tables complete round 1');
  });

  test('management lock: acquire, block other session, release', async () => {
    const id = gameId();
    await api('/api/games', { method: 'POST', body: { gameId: id } });

    // Acquire lock
    const acquire = await api(`/api/games/${id}`, {
      method: 'PATCH',
      headers: { 'x-session-id': 'session-A' },
      body: { managementSessionId: 'session-A' }
    });
    assert.equal(acquire.status, 200);

    // Different session cannot acquire
    const blocked = await api(`/api/games/${id}`, {
      method: 'PATCH',
      headers: { 'x-session-id': 'session-B' },
      body: { managementSessionId: 'session-B' }
    });
    assert.equal(blocked.status, 423);

    // Original session releases lock
    const release = await api(`/api/games/${id}`, {
      method: 'PATCH',
      headers: { 'x-session-id': 'session-A' },
      body: { managementSessionId: null }
    });
    assert.equal(release.status, 200);
    const released = await release.json();
    assert.equal(released.managementSessionId, undefined, 'Lock should be released');
  });
});

describe('PUT /api/games/:id', () => {
  test('replaces entire game state', async () => {
    const id = gameId();
    await api('/api/games', {
      method: 'POST',
      body: { gameId: id, currentRound: 1, someField: 'original' }
    });

    const res = await api(`/api/games/${id}`, {
      method: 'PUT',
      body: { gameId: id, currentRound: 2, replaced: true }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.currentRound, 2);
    assert.equal(body.replaced, true);
    assert.equal(body.someField, undefined, 'PUT replaces entirely — old fields gone');
  });
});

describe('full two-round game flow', () => {
  test('both tables and a manager play through two complete rounds', async () => {
    const id = gameId();

    // Manager creates the game
    await api('/api/games', {
      method: 'POST',
      body: {
        gameId: id,
        currentRound: 1,
        boardsPerRound: 4,
        managementSessionId: 'mgmt',
        tables: {
          '1': { sessionId: 'session-t1' },
          '2': { sessionId: 'session-t2' }
        }
      }
    });

    // Build a helper to submit all 4 boards for a table in a given round
    async function submitRound(tableNum, session, round) {
      const base = (round - 1) * 4;
      const scores = {};
      for (let i = 1; i <= 4; i++) {
        const board = base + i;
        scores[String(board)] = {
          board,
          level: 3,
          strain: 'NT',
          double: '',
          declarer: tableNum === '1' ? 'north' : 'east',
          tricksTaken: 9
        };
      }
      return api(`/api/games/${id}`, {
        method: 'PATCH',
        body: { tables: { [tableNum]: { sessionId: session, scores: { [round]: scores } } } }
      });
    }

    // --- Round 1 ---
    await submitRound('1', 'session-t1', 1);
    const afterR1T2 = await submitRound('2', 'session-t2', 1);
    const gameR1End = await afterR1T2.json();
    assert.equal(afterR1T2.status, 200);
    assert.equal(gameR1End.currentRound, 2, 'Game should auto-advance to round 2');

    // Manager can see all scores from round 1
    const mgmtView = await api(`/api/games/${id}?management=true`, {
      headers: { 'x-management-session-id': 'mgmt' }
    });
    const mgmtGame = await mgmtView.json();
    assert.equal(Object.keys(mgmtGame.tables['1'].scores['1']).length, 4, 'Table 1 should have 4 round-1 scores');
    assert.equal(Object.keys(mgmtGame.tables['2'].scores['1']).length, 4, 'Table 2 should have 4 round-1 scores');

    // --- Round 2 ---
    await submitRound('1', 'session-t1', 2);
    const afterR2T2 = await submitRound('2', 'session-t2', 2);
    const gameR2End = await afterR2T2.json();
    assert.equal(gameR2End.currentRound, 3, 'Game should auto-advance to round 3');
  });
});
