'use strict';

/**
 * PostgreSQL-backed data store and subscription tier definitions.
 * Requires DATABASE_URL environment variable (set automatically by Render
 * when you link an internal PostgreSQL database to the web service).
 */

const { Pool } = require('pg');

// ── Subscription Tiers (mirrors js/app.js SUBSCRIPTION_TIERS) ─────────────────
const SUBSCRIPTION_TIERS = {
  free_intern: { price: 0,     dailyROI: 0,    durationDays: 3,  maxEarnings: 0     },
  starter:     { price: 100,   dailyROI: 0.05, durationDays: 30, maxEarnings: 200   },
  bronze:      { price: 500,   dailyROI: 0.05, durationDays: 30, maxEarnings: 1000  },
  silver:      { price: 1000,  dailyROI: 0.05, durationDays: 30, maxEarnings: 2000  },
  gold:        { price: 5000,  dailyROI: 0.05, durationDays: 30, maxEarnings: 10000 },
  platinum:    { price: 10000, dailyROI: 0.05, durationDays: 30, maxEarnings: 20000 },
  diamond:     { price: 20000, dailyROI: 0.05, durationDays: 30, maxEarnings: 40000 },
};

// ── PostgreSQL pool ───────────────────────────────────────────────────────────
// Render sets RENDER=true for all web services. When running on Render, the
// internal database uses a self-signed TLS certificate so we must disable
// certificate verification. For all other environments (local dev, etc.) we
// use the default SSL behaviour.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.RENDER
    ? { rejectUnauthorized: false }
    : false,
});

// ── Utility ───────────────────────────────────────────────────────────────────
function generateId() {
  return 'cc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ── Row mappers (snake_case DB columns → camelCase JS objects) ────────────────
function rowToUser(r) {
  if (!r) return null;
  return {
    id:                    r.id,
    username:              r.username,
    email:                 r.email,
    passwordHash:          r.password_hash,
    isAdmin:               r.is_admin,
    wallet:                parseFloat(r.wallet),
    totalEarned:           parseFloat(r.total_earned),
    referralCode:          r.referral_code,
    referredBy:            r.referred_by,
    referralEarnings:      parseFloat(r.referral_earnings),
    subscription:          r.subscription,
    createdAt:             Number(r.created_at),
    lastEarningsProcessed: r.last_earnings_processed !== null && r.last_earnings_processed !== undefined ? Number(r.last_earnings_processed) : null,
    watchedTrailers:       r.watched_trailers || [],
    dailyEarnings:         r.daily_earnings !== null && r.daily_earnings !== undefined ? parseFloat(r.daily_earnings) : 0,
    dailyEarningsDate:     r.daily_earnings_date || null,
    dailyClipsWatched:     r.daily_clips_watched !== null && r.daily_clips_watched !== undefined ? Number(r.daily_clips_watched) : 0,
  };
}

function rowToTransaction(r) {
  if (!r) return null;
  return {
    id:          r.id,
    userId:      r.user_id,
    username:    r.username,
    email:       r.email,
    type:        r.type,
    tier:        r.tier,
    tierName:    r.tier_name,
    amount:      parseFloat(r.amount),
    status:      r.status,
    method:      r.method,
    note:        r.note,
    createdAt:   Number(r.created_at),
    processedAt: r.processed_at,
    processedBy: r.processed_by,
  };
}

function rowToWithdrawal(r) {
  if (!r) return null;
  return {
    id:          r.id,
    userId:      r.user_id,
    username:    r.username,
    email:       r.email,
    amount:      parseFloat(r.amount),
    fee:         parseFloat(r.fee),
    net:         parseFloat(r.net),
    method:      r.method,
    account:     r.account,
    status:      r.status,
    createdAt:   Number(r.created_at),
    processedAt: r.processed_at,
    processedBy: r.processed_by,
  };
}

// ── Database migration — creates tables if they do not exist ──────────────────
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                      TEXT PRIMARY KEY,
      username                TEXT NOT NULL UNIQUE,
      email                   TEXT NOT NULL UNIQUE,
      password_hash           TEXT NOT NULL,
      is_admin                BOOLEAN NOT NULL DEFAULT FALSE,
      wallet                  NUMERIC(14,4) NOT NULL DEFAULT 0,
      total_earned            NUMERIC(14,4) NOT NULL DEFAULT 0,
      referral_code           TEXT,
      referred_by             TEXT,
      referral_earnings       NUMERIC(14,4) NOT NULL DEFAULT 0,
      subscription            JSONB,
      created_at              BIGINT NOT NULL,
      last_earnings_processed BIGINT,
      watched_trailers        TEXT[] NOT NULL DEFAULT '{}',
      daily_earnings          NUMERIC(14,4) NOT NULL DEFAULT 0,
      daily_earnings_date     TEXT,
      daily_clips_watched     INT NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      username     TEXT NOT NULL DEFAULT '',
      email        TEXT NOT NULL DEFAULT '',
      type         TEXT NOT NULL,
      tier         TEXT,
      tier_name    TEXT,
      amount       NUMERIC(14,4) NOT NULL DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'pending',
      method       TEXT,
      note         TEXT,
      created_at   BIGINT NOT NULL,
      processed_at TEXT,
      processed_by TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      username     TEXT NOT NULL DEFAULT '',
      email        TEXT NOT NULL DEFAULT '',
      amount       NUMERIC(14,4) NOT NULL,
      fee          NUMERIC(14,4) NOT NULL,
      net          NUMERIC(14,4) NOT NULL,
      method       TEXT,
      account      TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   BIGINT NOT NULL,
      processed_at TEXT,
      processed_by TEXT
    )
  `);

  // Backfill columns for existing databases
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_earnings NUMERIC(14,4) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_earnings_date TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_clips_watched INT NOT NULL DEFAULT 0`);

  console.log('[DB] Tables migrated successfully');
}

// ── User queries ─────────────────────────────────────────────────────────────
async function getUsers() {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
  return rows.map(rowToUser);
}

async function findUser(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rowToUser(rows[0]) || null;
}

async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  return rowToUser(rows[0]) || null;
}

async function findUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  return rowToUser(rows[0]) || null;
}

async function findUserByReferralCode(code) {
  const { rows } = await pool.query('SELECT * FROM users WHERE referral_code = $1', [code]);
  return rowToUser(rows[0]) || null;
}

async function saveUser(user) {
  await pool.query(`
    INSERT INTO users
      (id, username, email, password_hash, is_admin, wallet, total_earned,
       referral_code, referred_by, referral_earnings, subscription,
       created_at, last_earnings_processed, watched_trailers,
       daily_earnings, daily_earnings_date, daily_clips_watched)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    ON CONFLICT (id) DO UPDATE SET
      username                = EXCLUDED.username,
      email                   = EXCLUDED.email,
      password_hash           = EXCLUDED.password_hash,
      is_admin                = EXCLUDED.is_admin,
      wallet                  = EXCLUDED.wallet,
      total_earned            = EXCLUDED.total_earned,
      referral_code           = EXCLUDED.referral_code,
      referred_by             = EXCLUDED.referred_by,
      referral_earnings       = EXCLUDED.referral_earnings,
      subscription            = EXCLUDED.subscription,
      created_at              = EXCLUDED.created_at,
      last_earnings_processed = EXCLUDED.last_earnings_processed,
      watched_trailers        = EXCLUDED.watched_trailers,
      daily_earnings          = EXCLUDED.daily_earnings,
      daily_earnings_date     = EXCLUDED.daily_earnings_date,
      daily_clips_watched     = EXCLUDED.daily_clips_watched
  `, [
    user.id,
    user.username,
    user.email,
    user.passwordHash,
    user.isAdmin || false,
    user.wallet || 0,
    user.totalEarned || 0,
    user.referralCode || null,
    user.referredBy || null,
    user.referralEarnings || 0,
    user.subscription ? JSON.stringify(user.subscription) : null,
    user.createdAt,
    user.lastEarningsProcessed || null,
    user.watchedTrailers || [],
    user.dailyEarnings || 0,
    user.dailyEarningsDate || null,
    user.dailyClipsWatched || 0,
  ]);
  return user;
}

// ── Transaction queries ───────────────────────────────────────────────────────
async function getTransactions() {
  const { rows } = await pool.query('SELECT * FROM transactions ORDER BY created_at DESC');
  return rows.map(rowToTransaction);
}

async function getUserTransactions(userId, limit = 50) {
  const { rows } = await pool.query(
    'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return rows.map(rowToTransaction);
}

async function findTransaction(id) {
  const { rows } = await pool.query('SELECT * FROM transactions WHERE id = $1', [id]);
  return rowToTransaction(rows[0]) || null;
}

async function saveTransaction(tx) {
  await pool.query(`
    INSERT INTO transactions
      (id, user_id, username, email, type, tier, tier_name, amount,
       status, method, note, created_at, processed_at, processed_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT (id) DO UPDATE SET
      status       = EXCLUDED.status,
      processed_at = EXCLUDED.processed_at,
      processed_by = EXCLUDED.processed_by
  `, [
    tx.id,
    tx.userId,
    tx.username || '',
    tx.email || '',
    tx.type,
    tx.tier || null,
    tx.tierName || null,
    tx.amount,
    tx.status,
    tx.method || null,
    tx.note || null,
    tx.createdAt,
    tx.processedAt || null,
    tx.processedBy || null,
  ]);
  return tx;
}

// ── Withdrawal queries ───────────────────────────────────────────────────────
async function getWithdrawals() {
  const { rows } = await pool.query('SELECT * FROM withdrawals ORDER BY created_at DESC');
  return rows.map(rowToWithdrawal);
}

async function getUserWithdrawals(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows.map(rowToWithdrawal);
}

async function findWithdrawal(id) {
  const { rows } = await pool.query('SELECT * FROM withdrawals WHERE id = $1', [id]);
  return rowToWithdrawal(rows[0]) || null;
}

async function saveWithdrawal(w) {
  await pool.query(`
    INSERT INTO withdrawals
      (id, user_id, username, email, amount, fee, net,
       method, account, status, created_at, processed_at, processed_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (id) DO UPDATE SET
      status       = EXCLUDED.status,
      processed_at = EXCLUDED.processed_at,
      processed_by = EXCLUDED.processed_by
  `, [
    w.id,
    w.userId,
    w.username || '',
    w.email || '',
    w.amount,
    w.fee,
    w.net,
    w.method,
    w.account,
    w.status,
    w.createdAt,
    w.processedAt || null,
    w.processedBy || null,
  ]);
  return w;
}

// ── Admin stats (single round-trip) ──────────────────────────────────────────
async function getStats() {
  const now = Date.now();
  const [
    { rows: [userCount] },
    { rows: [pendingW] },
    { rows: [pendingT] },
    { rows: [totalWVol] },
    { rows: [activeSubs] },
  ] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS count FROM users'),
    pool.query("SELECT COUNT(*)::int AS count FROM withdrawals WHERE status = 'pending'"),
    pool.query("SELECT COUNT(*)::int AS count FROM transactions WHERE status = 'pending'"),
    pool.query('SELECT COALESCE(SUM(amount), 0)::float AS total FROM withdrawals'),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM users
       WHERE subscription IS NOT NULL
         AND (subscription->>'expiresAt')::bigint > $1
         AND subscription->>'tier' != 'free_intern'`,
      [now]
    ),
  ]);
  return {
    totalUsers:           userCount.count,
    pendingWithdrawals:   pendingW.count,
    pendingTransactions:  pendingT.count,
    totalWithdrawalVolume: totalWVol.total,
    activeSubscriptions:  activeSubs.count,
  };
}

// ── Store object ──────────────────────────────────────────────────────────────
const store = {
  getUsers,
  findUser,
  findUserByEmail,
  findUserByUsername,
  findUserByReferralCode,
  saveUser,
  getTransactions,
  getUserTransactions,
  findTransaction,
  saveTransaction,
  getWithdrawals,
  getUserWithdrawals,
  findWithdrawal,
  saveWithdrawal,
  getStats,
};

module.exports = { store, SUBSCRIPTION_TIERS, generateId, migrate, pool };
