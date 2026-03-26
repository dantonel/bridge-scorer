# Bridge Scorer - Claude Instructions

## Project Overview
Bridge Scorer is a Node.js + vanilla HTML app for Individual IMP scoring in Bridge card games.
It uses Express (app.js) as the entry point, with all API logic in server.js and a static frontend in index.html.
Data is persisted in Redis.

## Architecture
- `app.js` — Express server, entry point, listens on PORT (default 3000)
- `server.js` — All API route handlers (exported as named `handler`)
- `index.html` — Entire frontend (vanilla JS, no framework)
- Redis — Sole data store, accessed via REDIS_URL environment variable

## Branch Strategy
- `main` — production, Vercel deployment, do not touch
- `dev` — primary integration branch, Express/OpenShift version
- `qa` — pre-prod validation
- `claude` — your working branch, always branch from and PR back to `dev`

## How Claude Should Work
- Always work on the `claude` branch
- Always open PRs targeting `dev`, never `main`
- Never commit directly to `main`, `dev`, or `qa`
- Keep PRs small and focused — one issue, one PR
- Write a clear PR description explaining what was changed and why

## Code Style
- ES Modules throughout (`import`/`export`, never `require`)
- Async/await preferred over callbacks or raw promises
- Console.log for debugging is fine, but include context e.g. `console.log('Getting game:', gameId)`
- No TypeScript, no build step, keep it simple

## API Conventions
- All API routes live under `/api/`
- Responses always use `sendJSON(res, statusCode, data)`
- Auth is handled via headers: `x-session-id`, `x-management-session-id`, `x-table-number`
- Redis keys follow the pattern `game:{gameId}`
- Games expire after 86400 seconds (24 hours)

## Environment Variables
- `REDIS_URL` — Redis connection string (required)
- `PORT` — Server port (default 3000)
- `NODE_ENV` — Environment name
- `GIT_BRANCH` — Current branch (set by CI)
- `GIT_COMMIT_SHA` — Current commit (set by CI)
- `APP_URL` — Public URL of the deployment

## Testing
- Always write tests alongside code changes — new functionality gets unit or integration tests in the same PR
- Bug fixes get a regression test that would have caught the bug
- Use Node's built-in `node:test` runner (`npm test` runs all tests)
- Pure logic (e.g. `lib/scoring.js`) goes in unit tests; route/Redis behaviour goes in integration tests
- Every new API route gets at least one integration test
- Tests run against a real Redis instance — no mocking
- Do not break existing API contracts — the frontend depends on exact response shapes

## Things to Be Careful About
- Redis connection is lazy and shared — don't create multiple clients
- Game state uses deepMerge for PATCH updates — understand this before modifying update logic
- Round auto-advance logic runs on both PATCH and PUT — keep them in sync
- CORS headers are set manually on every request — don't remove them
- The `claude` branch auto-deploys to its own OpenShift namespace — your changes will be live there for review
