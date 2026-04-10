'use strict';

require('dotenv').config();
const express   = require('express');
const bcrypt    = require('bcryptjs');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const webhookRoutes    = require('./routes/webhook');
const adminRoutes      = require('./routes/admin');
const authRoutes       = require('./routes/auth');
const userRoutes       = require('./routes/user');
const depositRoutes    = require('./routes/deposit');
const withdrawalRoutes = require('./routes/withdrawal');

const { store, migrate } = require('./routes/store');

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

// ── Rate Limiting ─────────────────────────────────────────────────────────────
// Applies strict limits to login/register and admin login endpoints to slow
// brute-force and credential-stuffing attacks.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests from this IP, please try again later.' },
});
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/admin/login',   authLimiter);

// Limit deposit initiations to prevent abuse (10 per 15 minutes per IP).
const depositLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many deposit requests from this IP, please try again later.' },
});
app.use('/api/deposit/initiate', depositLimiter);

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
// Creates a demo user in the database so the demo login works out of the box.
// Skipped automatically if the demo user already exists (idempotent).
async function seedDemoData() {
  const existing = await store.findUserByEmail('demo@clipcash.co.za');
  if (existing) {
    console.log('[Server] Demo user already exists, skipping seed');
    return;
  }

  const passwordHash = await bcrypt.hash('demo123', 10);
  const now = Date.now();

  await store.saveUser({
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
migrate()
  .then(() => seedDemoData())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ClipCASH backend running on port ${PORT}`);
      console.log('⚠️  For production: set JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, and YOCO_WEBHOOK_SECRET in .env');
    });
  })
  .catch(err => {
    console.error('[Server] Startup error:', err.message);
    process.exit(1);
  });

module.exports = app;
