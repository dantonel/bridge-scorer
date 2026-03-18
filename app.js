import express from 'express';
import { handler } from './server.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON request bodies
app.use(express.json());

// Serve static files (your index.html etc)
app.use(express.static('.'));

// Route all /api requests to your existing handler
app.all('/api/*', handler);

// Fallback: serve index.html for everything else
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: '.' });
});

app.listen(PORT, () => {
  console.log(`Bridge Scorer running on port ${PORT}`);
});
