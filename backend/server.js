'use strict';

require('dotenv').config();
const express = require('express');
const bcrypt  = require('bcryptjs');
const cors    = require('cors');

const webhookRoutes    = require('./routes/webhook');
const adminRoutes      = require('./routes/admin');
const authRoutes       = require('./routes/auth');
const userRoutes       = require('./routes/user');
const depositRoutes    = require('./routes/deposit');
const withdrawalRoutes = require('./routes/withdrawal');

const { store } = require('./routes/store');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
// Set ALLOWED_ORIGIN in .env to your frontend domain (e.g. https://clipcash.co.za).
// Leaving it unset in production will block all cross-origin requests.
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors({
  origin: allowedOrigin || false,
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
}));

// Raw body needed for Yoco webhook signature verification
app.use('/api/webhook', express.raw({ type: 'application/json' }));
// JSON body for all other routes
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/webhook',    webhookRoutes);
app.use('/api/admin',      adminRoutes);
app.use('/api/auth',       authRoutes);
app.use('/api/user',       userRoutes);
app.use('/api/deposit',    depositRoutes);
app.use('/api/withdrawal', withdrawalRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ClipCASH Error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Seed Demo Data ────────────────────────────────────────────────────────────
// Creates a demo user in the in-memory store so the demo login works out of the box.
// In production, remove this and use a real database with real user accounts.
async function seedDemoData() {
  const passwordHash = await bcrypt.hash('demo123', 10);
  const now = Date.now();

  store.users.push({
    id:                    'user_demo',
    username:              'DemoUser',
    email:                 'demo@clipcash.co.za',
    passwordHash,
    isAdmin:               false,
    wallet:                500,
    totalEarned:           2500,
    referralCode:          'DEMO2024',
    referredBy:            null,
    referralEarnings:      150,
    subscription: {
      tier:        'gold',
      activatedAt: now - 10 * 86400000,
      expiresAt:   now + 20 * 86400000,
    },
    createdAt:             now - 15 * 86400000,
    lastEarningsProcessed: now - 86400000,
    watchedTrailers:       [],
  });

  console.log('[Server] Demo data seeded (demo@clipcash.co.za / demo123)');
}

// ── Start ─────────────────────────────────────────────────────────────────────
seedDemoData().then(() => {
  app.listen(PORT, () => {
    console.log(`ClipCASH backend running on port ${PORT}`);
    console.log('⚠️  For production: set JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, and YOCO_WEBHOOK_SECRET in .env');
  });
});

module.exports = app;
