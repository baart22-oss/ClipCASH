'use strict';

require('dotenv').config();
const express   = require('express');
const bcrypt    = require('bcryptjs');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const adminRoutes      = require('./routes/admin');
const authRoutes       = require('./routes/auth');
const userRoutes       = require('./routes/user');
const depositRoutes    = require('./routes/deposit');
const withdrawalRoutes = require('./routes/withdrawal');

const { store, migrate } = require('./routes/store');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors({
  origin: allowedOrigin || false,
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
}));

app.use(express.json({ limit: '10mb' }));

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests from this IP, please try again later.' },
});
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/admin/login',   authLimiter);

// deposit submit limit
const depositLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many deposit requests from this IP, please try again later.' },
});
app.use('/api/deposit/initiate', depositLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/admin',      adminRoutes);
app.use('/api/auth',       authRoutes);
app.use('/api/user',       userRoutes);
app.use('/api/deposit',    depositRoutes);
app.use('/api/withdrawal', withdrawalRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, _req, res, _next) => {
  console.error('[ClipCASH Error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Seed Demo Data ────────────────────────────────────────────────────────────
async function seedDemoData() {
  const existing = await store.findUserByEmail('demo@clipcash.co.za');
  if (existing) return;

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
      expiresAt:   now + 30 * 86400000,
    },
    createdAt:             now - 15 * 86400000,
    lastEarningsProcessed: now - 86400000,
    watchedTrailers:       [],
    dailyEarnings:         0,
    dailyEarningsDate:     new Date(now).toISOString().slice(0, 10),
    dailyClipsWatched:     0,
  });

  console.log('[Server] Demo data seeded (demo@clipcash.co.za / demo123)');
}

// ── Start ���────────────────────────────────────────────────────────────────────
migrate()
  .then(() => seedDemoData())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ClipCASH backend running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('[Server] Startup error:', err.message);
    process.exit(1);
  });

module.exports = app;
