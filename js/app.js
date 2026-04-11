/* =============================================
   app.js – Shared utilities, constants, helpers
   ============================================= */

'use strict';

// ── API Configuration ────────────────────────────────────────────────────────
// Point this at your Render backend URL (no trailing slash).
// For local development you can override this to http://localhost:3000.
const API_BASE_URL = 'https://clipcash-kcif.onrender.com';

// Direct Yoco payment links for each paid plan.
const YOCO_PAYMENT_LINKS = {
  starter:  'https://pay.yoco.com/r/4WwMwR',
  bronze:   'https://pay.yoco.com/r/78MLMM',
  silver:   'https://pay.yoco.com/r/70bzVD',
  gold:     'https://pay.yoco.com/r/2wRJg5',
  platinum: 'https://pay.yoco.com/r/meg501',
  diamond:  'https://pay.yoco.com/r/2Bp0Gr',
};

/**
 * Make an authenticated request to the backend.
 * Attaches the admin JWT (sessionStorage) or user JWT (localStorage) as
 * Authorization: Bearer <token>. Admin token takes priority.
 */
async function apiRequest(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});

  const adminToken = getAdminToken();
  const userToken  = getUserToken();
  const token      = adminToken || userToken;
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const response = await fetch(API_BASE_URL + path, {
    ...opts,
    headers,
    body: opts.body !== undefined
      ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
      : undefined,
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw Object.assign(new Error(data.error || `HTTP ${response.status}`), {
      status: response.status,
      data,
    });
  }

  return data;
}

// ── Admin Session Token (sessionStorage) ─────────────────────────────────────
const LS_ADMIN_TOKEN = 'clipcash_admin_token';

function getAdminToken()      { return sessionStorage.getItem(LS_ADMIN_TOKEN) || null; }
function setAdminToken(token) { sessionStorage.setItem(LS_ADMIN_TOKEN, token); }
function clearAdminToken()    { sessionStorage.removeItem(LS_ADMIN_TOKEN); }

// ── User JWT (localStorage) ───────────────────────────────────────────────────
const LS_USER_TOKEN = 'clipcash_user_token';

function getUserToken()      { return localStorage.getItem(LS_USER_TOKEN) || null; }
function setUserToken(token) { localStorage.setItem(LS_USER_TOKEN, token); }
function clearUserToken()    { localStorage.removeItem(LS_USER_TOKEN); }

// ── Subscription Tiers ────────────────────────────────────────────────���──────
const SUBSCRIPTION_TIERS = {
  free_intern: { name: 'Free Intern', price: 0, dailyROI: 0, durationDays: 3, maxEarnings: 0 },
  starter:     { name: 'Starter',     price: 100, dailyROI: 0.05, durationDays: 30, maxEarnings: 200 },
  bronze:      { name: 'Bronze',      price: 500, dailyROI: 0.05, durationDays: 30, maxEarnings: 1000 },
  silver:      { name: 'Silver',      price: 1000, dailyROI: 0.05, durationDays: 30, maxEarnings: 2000 },
  gold:        { name: 'Gold',        price: 5000, dailyROI: 0.05, durationDays: 30, maxEarnings: 10000 },
  platinum:    { name: 'Platinum',    price: 10000, dailyROI: 0.05, durationDays: 30, maxEarnings: 20000 },
  diamond:     { name: 'Diamond',     price: 20000, dailyROI: 0.05, durationDays: 30, maxEarnings: 40000 },
};

const TIER_ICONS = {
  free_intern: '🎬',
  starter:     '🌱',
  bronze:      '🥉',
  silver:      '🥈',
  gold:        '🥇',
  platinum:    '💎',
  diamond:     '👑',
};

const REFERRAL_LEVELS = { 1: 0.10, 2: 0.05, 3: 0.02 };

// ── Formatting Helpers ───────────────────────────────────────────────────────
function formatZAR(amount) {
  const n = Number(amount) || 0;
  return 'R' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeAgo(ts) {
  const diff  = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  if (hours < 24) return hours + 'h ago';
  return days + 'd ago';
}

function generateCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generateId() {
  return 'cc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ── Current User Cache ───────────────────────────────────────────────────────
const LS_USER_KEY = 'clipcash_user';

function getCurrentUser()   { return JSON.parse(localStorage.getItem(LS_USER_KEY) || 'null'); }
function saveCurrentUser(u) { localStorage.setItem(LS_USER_KEY, JSON.stringify(u)); }
function clearCurrentUser() { localStorage.removeItem(LS_USER_KEY); }

// ── Auth Guards ───────────────────────────────────────────────────────────────
function requireAuth() {
  const token = getUserToken();
  const user  = getCurrentUser();
  if (!token || !user) {
    window.location.href = 'login.html';
    return null;
  }
  return user;
}

// ── Earnings Logic ───────────────────────────────────────────────────────────
function getActiveTier(user) {
  if (!user.subscription || !user.subscription.tier) return null;
  const tier = SUBSCRIPTION_TIERS[user.subscription.tier];
  if (!tier) return null;
  const now = Date.now();
  if (user.subscription.expiresAt && now > user.subscription.expiresAt) return null;
  return tier;
}

function isAccountLocked(user) {
  const tier = getActiveTier(user);
  if (!tier || tier.maxEarnings === 0) return false;
  return (user.totalEarned || 0) >= tier.maxEarnings;
}

function calculateDailyEarnings(user) {
  const tier = getActiveTier(user);
  if (!tier || tier.dailyROI === 0) return 0;
  const remaining = tier.maxEarnings - (user.totalEarned || 0);
  if (remaining <= 0) return 0;
  return Math.min(tier.price * tier.dailyROI, remaining);
}

function calculatePerTrailerEarning(user) {
  const tier = getActiveTier(user);
  if (!tier || tier.dailyROI === 0) return 0;
  return parseFloat(((tier.price * tier.dailyROI) / 10).toFixed(4));
}

function getDailyEarningsCap(user) {
  const tier = getActiveTier(user);
  if (!tier || tier.dailyROI === 0) return 0;
  return parseFloat((tier.price * tier.dailyROI).toFixed(4));
}

function getDailyClipLimit(_user) {
  return 10;
}

// ── Toast Notifications ───────────────────────────────────────────────────────
function showToast(message, type = 'success', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span class="toast-text">${message}</span>
    <span class="toast-close" onclick="this.parentElement.remove()">✕</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ── Navigation Helpers ───────────────────────────────────────────────────────
function renderNav() {
  const nav = document.getElementById('main-nav');
  if (!nav) return;
  const user = getCurrentUser();

  let links = `
    <a href="index.html">Home</a>
    <a href="index.html#how-it-works">How It Works</a>
    <a href="index.html#pricing">Pricing</a>
  `;

  if (user) {
    links += `<a href="dashboard.html">Dashboard</a>`;
    links += `<a href="deposit.html" class="btn btn-primary btn-sm">Deposit</a>`;
    links += `<a href="#" onclick="handleLogout(event)" class="btn btn-secondary btn-sm">Logout</a>`;
  } else {
    links += `<a href="login.html">Login</a>`;
    links += `<a href="login.html?tab=register" class="btn btn-primary btn-sm">Get Started</a>`;
  }

  nav.innerHTML = links;

  const mobileNav = document.getElementById('mobile-nav');
  if (mobileNav) {
    let mobileLinks = `
      <a href="index.html">🏠 Home</a>
      <a href="index.html#how-it-works">❓ How It Works</a>
      <a href="index.html#pricing">💰 Pricing</a>
    `;
    if (user) {
      mobileLinks += `<a href="dashboard.html">📊 Dashboard</a>`;
      mobileLinks += `<a href="deposit.html">💳 Deposit</a>`;
      mobileLinks += `<a href="withdrawal.html">💸 Withdraw</a>`;
      mobileLinks += `<a href="#" onclick="handleLogout(event)">🚪 Logout</a>`;
    } else {
      mobileLinks += `<a href="login.html">🔑 Login</a>`;
      mobileLinks += `<a href="login.html?tab=register">✨ Get Started Free</a>`;
    }
    mobileNav.innerHTML = mobileLinks;
  }

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('#main-nav a, #mobile-nav a').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });
}

function toggleMobileNav() {
  const nav = document.getElementById('mobile-nav');
  if (nav) nav.classList.toggle('open');
}

function handleLogout(e) {
  if (e) e.preventDefault();
  clearCurrentUser();
  clearUserToken();
  clearAdminToken();
  window.location.href = 'index.html';
}

// ── Init on every page ───────────────────────���───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderNav();

  const toggle = document.getElementById('nav-toggle');
  if (toggle) toggle.addEventListener('click', toggleMobileNav);

  document.addEventListener('click', e => {
    const mNav = document.getElementById('mobile-nav');
    const tog  = document.getElementById('nav-toggle');
    if (mNav && mNav.classList.contains('open') && !mNav.contains(e.target) && tog && !tog.contains(e.target)) {
      mNav.classList.remove('open');
    }
  });
});
