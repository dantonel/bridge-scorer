import express from 'express';
import { existsSync } from 'node:fs';
import { handler } from './server.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Use Vite build output if available, otherwise fall back to source root
const staticRoot = existsSync('./dist/index.html') ? './dist' : '.';
console.log(`Serving static files from: ${staticRoot}`);

// Parse JSON request bodies
app.use(express.json());

// Serve static files (Vite dist/ if built, otherwise source root)
app.use(express.static(staticRoot));

// Route all /api requests to your existing handler
app.all('/api/*', handler);

// Fallback: serve index.html for everything else
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: staticRoot });
});

app.listen(PORT, () => {
  console.log(`Bridge Scorer running on port ${PORT}`);
});
