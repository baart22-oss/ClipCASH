/* =============================================
   app.js – Shared utilities, constants, helpers
   ============================================= */

'use strict';

// ── Subscription Tiers ──────────────────────────────────────────────────────
const SUBSCRIPTION_TIERS = {
  free_intern: { name: 'Free Intern',  price: 0,     dailyROI: 0,    durationDays: 3,  maxEarnings: 0     },
  starter:     { name: 'Starter',      price: 100,   dailyROI: 0.05, durationDays: 30, maxEarnings: 200   },
  bronze:      { name: 'Bronze',       price: 500,   dailyROI: 0.05, durationDays: 30, maxEarnings: 1000  },
  silver:      { name: 'Silver',       price: 1000,  dailyROI: 0.05, durationDays: 30, maxEarnings: 2000  },
  gold:        { name: 'Gold',         price: 5000,  dailyROI: 0.05, durationDays: 30, maxEarnings: 10000 },
  platinum:    { name: 'Platinum',     price: 10000, dailyROI: 0.05, durationDays: 30, maxEarnings: 20000 },
  diamond:     { name: 'Diamond',      price: 20000, dailyROI: 0.05, durationDays: 30, maxEarnings: 40000 },
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

const LS = {
  USER:   'clipcash_user',
  USERS:  'clipcash_users',
  ADMIN:  'clipcash_admin',
  SEEDED: 'clipcash_seeded',
};

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
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)   return 'just now';
  if (mins  < 60)  return mins  + 'm ago';
  if (hours < 24)  return hours + 'h ago';
  return days + 'd ago';
}

function generateCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generateId() {
  return 'cc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ── localStorage Helpers ─────────────────────────────────────────────────────
function getCurrentUser()     { return JSON.parse(localStorage.getItem(LS.USER)  || 'null'); }
function saveCurrentUser(u)   { localStorage.setItem(LS.USER, JSON.stringify(u)); }
function clearCurrentUser()   { localStorage.removeItem(LS.USER); }

function getUsers()           { return JSON.parse(localStorage.getItem(LS.USERS) || '[]'); }
function saveUsers(arr)       { localStorage.setItem(LS.USERS, JSON.stringify(arr)); }

function getAdminData() {
  return JSON.parse(localStorage.getItem(LS.ADMIN) || '{"withdrawals":[],"transactions":[]}');
}
function saveAdminData(d) { localStorage.setItem(LS.ADMIN, JSON.stringify(d)); }

function getUserById(id) {
  return getUsers().find(u => u.id === id) || null;
}

function updateUserInStore(updatedUser) {
  const users = getUsers().map(u => u.id === updatedUser.id ? updatedUser : u);
  saveUsers(users);
  const current = getCurrentUser();
  if (current && current.id === updatedUser.id) saveCurrentUser(updatedUser);
}

// ── Auth Guards ──────────────────────────────────────────────────────────────
function requireAuth() {
  const user = getCurrentUser();
  if (!user) { window.location.href = 'login.html'; return null; }
  return user;
}

function requireAdmin() {
  const user = requireAuth();
  if (!user) return null;
  if (!user.isAdmin) { window.location.href = 'index.html'; return null; }
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
  const maxEarn = tier.maxEarnings;
  const alreadyEarned = user.totalEarned || 0;
  const remaining = maxEarn - alreadyEarned;
  if (remaining <= 0) return 0;
  const daily = tier.price * tier.dailyROI;
  return Math.min(daily, remaining);
}

function calculatePerTrailerEarning(user) {
  const tier = getActiveTier(user);
  if (!tier || tier.dailyROI === 0) return 0;
  return parseFloat(((tier.price * tier.dailyROI) / 10).toFixed(4));
}

/** Credit earnings for every whole day elapsed since last login / last processed timestamp. */
function processPendingEarnings(user) {
  const tier = getActiveTier(user);
  if (!tier || tier.dailyROI === 0) return user;

  const now      = Date.now();
  const lastTs   = user.lastEarningsProcessed || user.createdAt || now;
  const msSince  = now - lastTs;
  const daysSince = Math.floor(msSince / 86400000);

  if (daysSince < 1) return user;

  const dailyAmt   = tier.price * tier.dailyROI;
  const cap        = tier.maxEarnings;
  let totalEarned  = user.totalEarned  || 0;
  let walletBalance = user.wallet       || 0;

  for (let i = 0; i < daysSince; i++) {
    if (totalEarned >= cap) break;
    const credit = Math.min(dailyAmt, cap - totalEarned);
    totalEarned   += credit;
    walletBalance += credit;
  }

  const updated = {
    ...user,
    totalEarned:          parseFloat(totalEarned.toFixed(4)),
    wallet:               parseFloat(walletBalance.toFixed(4)),
    lastEarningsProcessed: now,
  };
  updateUserInStore(updated);
  return updated;
}

// ── Referral Bonus ───────────────────────────────────────────────────────────
function creditReferralBonuses(newUser, subscriptionAmount) {
  if (!subscriptionAmount) return;
  let users = getUsers();

  // Level 1
  if (newUser.referredBy) {
    const l1 = users.find(u => u.referralCode === newUser.referredBy);
    if (l1) {
      const bonus1 = subscriptionAmount * REFERRAL_LEVELS[1];
      l1.wallet       = parseFloat(((l1.wallet || 0) + bonus1).toFixed(4));
      l1.referralEarnings = parseFloat(((l1.referralEarnings || 0) + bonus1).toFixed(4));
      addTransaction(l1.id, 'referral_bonus', bonus1, 'Level 1 referral bonus from ' + newUser.username, 'approved');

      // Level 2
      if (l1.referredBy) {
        const l2 = users.find(u => u.referralCode === l1.referredBy);
        if (l2) {
          const bonus2 = subscriptionAmount * REFERRAL_LEVELS[2];
          l2.wallet       = parseFloat(((l2.wallet || 0) + bonus2).toFixed(4));
          l2.referralEarnings = parseFloat(((l2.referralEarnings || 0) + bonus2).toFixed(4));
          addTransaction(l2.id, 'referral_bonus', bonus2, 'Level 2 referral bonus', 'approved');

          // Level 3
          if (l2.referredBy) {
            const l3 = users.find(u => u.referralCode === l2.referredBy);
            if (l3) {
              const bonus3 = subscriptionAmount * REFERRAL_LEVELS[3];
              l3.wallet       = parseFloat(((l3.wallet || 0) + bonus3).toFixed(4));
              l3.referralEarnings = parseFloat(((l3.referralEarnings || 0) + bonus3).toFixed(4));
              addTransaction(l3.id, 'referral_bonus', bonus3, 'Level 3 referral bonus', 'approved');
            }
          }
        }
      }

      // Objects in `users` were mutated by reference above; persist the array once.
      saveUsers(users);
    }
  }
}

// ── Transaction Log ──────────────────────────────────────────────────────────
function addTransaction(userId, type, amount, note, status = 'pending') {
  const admin = getAdminData();
  admin.transactions.push({
    id:        generateId(),
    userId,
    type,
    amount:    parseFloat(amount.toFixed(2)),
    note,
    status,
    createdAt: Date.now(),
  });
  saveAdminData(admin);
}

// ── Seed Demo Data ───────────────────────────────────────────────────────────
function seedDemoData() {
  if (localStorage.getItem(LS.SEEDED)) return;

  const now = Date.now();

  const adminUser = {
    id:           'user_admin',
    username:     'Admin',
    email:        'admin@clipcash.co.za',
    password:     'admin123',
    isAdmin:      true,
    wallet:       0,
    totalEarned:  0,
    referralCode: 'ADMIN001',
    referredBy:   null,
    referralEarnings: 0,
    subscription: null,
    createdAt:    now,
    lastEarningsProcessed: now,
    watchedTrailers: [],
  };

  const demoUser = {
    id:           'user_demo',
    username:     'DemoUser',
    email:        'demo@clipcash.co.za',
    password:     'demo123',
    isAdmin:      false,
    wallet:       500,
    totalEarned:  2500,
    referralCode: 'DEMO2024',
    referredBy:   null,
    referralEarnings: 150,
    subscription: {
      tier:       'gold',
      activatedAt: now - 10 * 86400000,
      expiresAt:   now + 20 * 86400000,
    },
    createdAt:    now - 15 * 86400000,
    lastEarningsProcessed: now - 86400000,
    watchedTrailers: [],
  };

  saveUsers([adminUser, demoUser]);
  saveAdminData({ withdrawals: [], transactions: [] });
  localStorage.setItem(LS.SEEDED, '1');
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

// ── Navigation Helpers ────────────────────────────────────────────────────────
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
    if (user.isAdmin) links += `<a href="admin.html">Admin</a>`;
    links += `<a href="deposit.html" class="btn btn-primary btn-sm">Deposit</a>`;
    links += `<a href="#" onclick="handleLogout(event)" class="btn btn-secondary btn-sm">Logout</a>`;
  } else {
    links += `<a href="login.html">Login</a>`;
    links += `<a href="login.html?tab=register" class="btn btn-primary btn-sm">Get Started</a>`;
  }

  nav.innerHTML = links;

  // Mobile nav
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
      if (user.isAdmin) mobileLinks += `<a href="admin.html">🔧 Admin</a>`;
      mobileLinks += `<a href="#" onclick="handleLogout(event)">🚪 Logout</a>`;
    } else {
      mobileLinks += `<a href="login.html">🔑 Login</a>`;
      mobileLinks += `<a href="login.html?tab=register">✨ Get Started Free</a>`;
    }
    mobileNav.innerHTML = mobileLinks;
  }

  // Active link highlight
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
  window.location.href = 'index.html';
}

// ── Init on every page ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  seedDemoData();
  renderNav();

  // Mobile toggle
  const toggle = document.getElementById('nav-toggle');
  if (toggle) toggle.addEventListener('click', toggleMobileNav);

  // Close mobile nav on outside click
  document.addEventListener('click', e => {
    const mNav = document.getElementById('mobile-nav');
    const tog  = document.getElementById('nav-toggle');
    if (mNav && mNav.classList.contains('open') && !mNav.contains(e.target) && tog && !tog.contains(e.target)) {
      mNav.classList.remove('open');
    }
  });
});
