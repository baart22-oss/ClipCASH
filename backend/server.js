'use strict';

require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const webhookRoutes = require('./routes/webhook');
const adminRoutes   = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
// Set ALLOWED_ORIGIN in .env to your frontend domain (e.g. https://clipcash.co.za).
// Leaving it unset in production will block all cross-origin requests.
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors({
  origin: allowedOrigin || false,
  methods: ['GET', 'POST', 'OPTIONS'],
}));

// Raw body needed for Yoco webhook signature verification
app.use('/api/webhook', express.raw({ type: 'application/json' }));
// JSON body for all other routes
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/webhook', webhookRoutes);
app.use('/api/admin',   adminRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ClipCash Error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`ClipCash backend running on port ${PORT}`);
  console.log('⚠️  For production: set YOCO_WEBHOOK_SECRET and ADMIN_API_KEY in .env');
});

module.exports = app;
