# Bridge Scorer - Individual IMP Scoring

A web application for scoring bridge games using Individual IMP scoring for 8 players across 7 rounds.

## Features

- Multi-device support (4 players on 4 devices)
- Real-time scoring synchronization
- Automatic movement and vulnerability calculation
- Session persistence (reconnect after refresh)
- Individual leaderboard
- Round-by-round game summary

## Architecture

- `app.js` — Express server entry point, listens on `PORT` (default 3000)
- `server.js` — All API route handlers
- `index.html` — Entire frontend (vanilla JS, no framework)
- Redis — Sole data store (`REDIS_URL` environment variable)

## Local Development

### Prerequisites

- Node.js
- A running Redis instance

### Setup

```bash
npm install
```

Set the required environment variable:

```bash
export REDIS_URL=redis://localhost:6379
```

Start the server:

```bash
node app.js
```

Then open `http://localhost:3000` in your browser.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `REDIS_URL` | Yes | Redis connection string |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment name |

## Deployment

The app runs on OpenShift. Branches map to environments as follows:

| Branch | Environment |
|---|---|
| `main` | Production (Vercel) |
| `dev` | Integration (OpenShift) |
| `qa` | Pre-prod (OpenShift) |
| `claude` | Review (OpenShift, auto-deployed) |

To deploy: open a PR from your branch to `dev`. Merging to `dev` triggers a deployment to the integration environment.
