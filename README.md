# Bridge Scorer - Individual IMP Scoring

A web application for scoring bridge games using Individual IMP scoring for 8 players across 7 rounds.

## Features

- Multi-device support (4 players on 4 devices)
- Real-time scoring synchronization
- Automatic movement and vulnerability calculation
- Session persistence (reconnect after refresh)
- Individual leaderboard
- Round-by-round game summary

## Deployment

This app is deployed on Vercel. To deploy updates:

1. Make changes to the code
2. Commit to GitHub: `git add . && git commit -m "Update description"`
3. Push: `git push`
4. Vercel will automatically deploy the changes

## Local Development

```bash
node server.js
```

Then open `http://localhost:3001` in your browser.
