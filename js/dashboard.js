/* =============================================
   dashboard.js – Trailer viewer, ROI, earnings
   ============================================= */

'use strict';

// ── Mock Trailer Playlist ─────────────────────────────────────────────────────
const TRAILERS = [
  { id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up',       genre: 'Music Video',   year: 1987 },
  { id: 'L_jWHffIx5E', title: 'Smells Like Teen Spirit',        genre: 'Music',         year: 1991 },
  { id: 'kJQP7kiw5Fk', title: 'Despacito',                      genre: 'Pop',           year: 2017 },
  { id: 'RgKAFK5djSk', title: 'See You Again',                   genre: 'Drama / R&B',  year: 2015 },
  { id: 'JGwWNGJdvx8', title: 'Shape of You',                    genre: 'Pop',           year: 2017 },
];

let currentTrailerIdx  = 0;
let timerInterval      = null;
let timerSeconds       = 15;
let timerRunning       = false;
let currentUser        = null;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  currentUser = requireAuth();
  if (!currentUser) return;

  // Process pending ROI since last login
  currentUser = processPendingEarnings(currentUser);

  renderDashboard();
  renderPlaylist();
  loadTrailer(0);
  checkAccountLock();
});

// ── Dashboard Stats ───────────────────────────────────────────────────────────
function renderDashboard() {
  const tier   = getActiveTier(currentUser);
  const tierInfo = tier ? SUBSCRIPTION_TIERS[currentUser.subscription.tier] : null;

  // Wallet
  setEl('stat-wallet', formatZAR(currentUser.wallet));
  // Total Earned
  setEl('stat-total-earned', formatZAR(currentUser.totalEarned));
  // Daily Earnings
  const daily = calculateDailyEarnings(currentUser);
  setEl('stat-daily', formatZAR(daily));
  // Subscription badge
  const tierKey = currentUser.subscription?.tier || 'free_intern';
  const tierName = SUBSCRIPTION_TIERS[tierKey]?.name || 'Free Intern';
  setEl('stat-sub', (TIER_ICONS[tierKey] || '🎬') + ' ' + tierName);

  // Subscription detail card
  renderSubCard();

  // Earnings cap progress
  renderCapProgress();

  // Referral code
  setEl('referral-code-display', currentUser.referralCode || '—');

  // Referral earnings
  setEl('stat-referral', formatZAR(currentUser.referralEarnings || 0));
}

function renderSubCard() {
  const sub      = currentUser.subscription;
  const tierKey  = sub?.tier || 'free_intern';
  const tier     = SUBSCRIPTION_TIERS[tierKey];
  const tierName = tier?.name || 'Free Intern';
  const icon     = TIER_ICONS[tierKey] || '🎬';

  setEl('sub-tier-label', icon + ' ' + tierName);

  if (sub && sub.activatedAt) {
    setEl('sub-activated', formatDate(sub.activatedAt));
    setEl('sub-expires',   sub.expiresAt ? formatDate(sub.expiresAt) : '—');
    setEl('sub-daily-roi', tier ? formatZAR(tier.price * tier.dailyROI) : 'R0.00');
    setEl('sub-max-earn',  tier ? formatZAR(tier.maxEarnings) : 'R0.00');
  }
}

function renderCapProgress() {
  const tierKey    = currentUser.subscription?.tier;
  const tier       = tierKey ? SUBSCRIPTION_TIERS[tierKey] : null;
  const earned     = currentUser.totalEarned || 0;
  const cap        = tier?.maxEarnings || 0;
  const pct        = cap > 0 ? Math.min((earned / cap) * 100, 100) : 0;

  const bar        = document.getElementById('cap-bar-fill');
  const capLabel   = document.getElementById('cap-progress-label');
  const capCurrent = document.getElementById('cap-current');
  const capMax     = document.getElementById('cap-max');

  if (bar)        bar.style.width  = pct.toFixed(1) + '%';
  if (capCurrent) capCurrent.textContent = formatZAR(earned);
  if (capMax)     capMax.textContent     = cap > 0 ? formatZAR(cap) : 'N/A';
  if (capLabel) {
    if (cap === 0) {
      capLabel.textContent = 'Upgrade to earn ROI';
    } else if (pct >= 100) {
      capLabel.textContent = '🔒 Cap Reached — Deposit to unlock';
      capLabel.style.color = 'var(--red)';
    } else {
      capLabel.textContent = pct.toFixed(1) + '% of cap reached';
    }
  }
}

// ── Account Lock ─────────────────────────────────────────────────────────────
function checkAccountLock() {
  const locked  = isAccountLocked(currentUser);
  const overlay = document.getElementById('lock-overlay');
  if (overlay) overlay.classList.toggle('hidden', !locked);
}

// ── Playlist ──────────────────────────────────────────────────────────────────
function renderPlaylist() {
  const list = document.getElementById('trailer-playlist');
  if (!list) return;

  list.innerHTML = TRAILERS.map((t, i) => {
    const watched = (currentUser.watchedTrailers || []).includes(t.id);
    return `
      <div class="playlist-item ${i === 0 ? 'active' : ''} ${watched ? 'watched' : ''}"
           id="playlist-item-${i}"
           onclick="loadTrailer(${i})">
        <div class="playlist-thumb-placeholder">🎬</div>
        <div class="playlist-info">
          <div class="playlist-title">${t.title}</div>
          <div class="playlist-meta">${t.genre} · ${t.year}</div>
        </div>
        <div class="playlist-status">${watched ? '✅' : '▶️'}</div>
      </div>
    `;
  }).join('');
}

function loadTrailer(idx) {
  if (isAccountLocked(currentUser)) {
    checkAccountLock();
    return;
  }

  stopTimer();
  currentTrailerIdx = idx;
  const trailer = TRAILERS[idx];

  // Update iframe
  const iframe = document.getElementById('trailer-iframe');
  if (iframe) {
    iframe.src = `https://www.youtube.com/embed/${trailer.id}?autoplay=1&mute=1&rel=0&modestbranding=1`;
  }

  // Update title
  setEl('trailer-title', trailer.title);
  setEl('trailer-genre', trailer.genre + ' · ' + trailer.year);

  // Reset progress bar
  const bar = document.getElementById('trailer-progress');
  if (bar) bar.style.width = '0%';

  // Highlight playlist item
  document.querySelectorAll('.playlist-item').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });

  // Start timer
  startTimer();
}

// ── 15-second Timer ───────────────────────────────────────────────────────────
function startTimer() {
  stopTimer();
  timerSeconds = 15;
  timerRunning = true;
  updateTimerUI();

  const progressBar = document.getElementById('trailer-progress');

  timerInterval = setInterval(() => {
    timerSeconds--;
    updateTimerUI();

    // Update progress bar
    const pct = ((15 - timerSeconds) / 15) * 100;
    if (progressBar) progressBar.style.width = pct + '%';

    if (timerSeconds <= 0) {
      stopTimer();
      onTrailerComplete();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerRunning = false;
}

function updateTimerUI() {
  const badge = document.getElementById('timer-badge');
  if (!badge) return;
  if (timerSeconds > 0) {
    badge.textContent = timerSeconds + 's';
    badge.classList.add('active');
  } else {
    badge.textContent = '✅';
    badge.classList.remove('active');
  }
}

function onTrailerComplete() {
  if (isAccountLocked(currentUser)) { checkAccountLock(); return; }

  const trailer    = TRAILERS[currentTrailerIdx];
  const earning    = calculatePerTrailerEarning(currentUser);
  const tier       = getActiveTier(currentUser);
  const cap        = tier?.maxEarnings || 0;
  const alreadyEarned = currentUser.totalEarned || 0;

  const creditedAmount = cap > 0
    ? Math.min(earning, cap - alreadyEarned)
    : 0;

  if (creditedAmount > 0) {
    currentUser.wallet      = parseFloat(((currentUser.wallet || 0) + creditedAmount).toFixed(4));
    currentUser.totalEarned = parseFloat((alreadyEarned + creditedAmount).toFixed(4));
  }

  // Mark trailer as watched
  if (!currentUser.watchedTrailers) currentUser.watchedTrailers = [];
  if (!currentUser.watchedTrailers.includes(trailer.id)) {
    currentUser.watchedTrailers.push(trailer.id);
  }
  currentUser.lastEarningsProcessed = Date.now();

  updateUserInStore(currentUser);

  // Show earn toast
  if (creditedAmount > 0) {
    showToast(`🎉 Earned ${formatZAR(creditedAmount)} for watching "${trailer.title}"!`, 'success');
  } else if (cap === 0) {
    showToast('Upgrade your plan to earn while watching!', 'info');
  }

  // Update UI
  renderDashboard();
  renderPlaylist();
  checkAccountLock();

  // Mark playlist item
  const item = document.getElementById(`playlist-item-${currentTrailerIdx}`);
  if (item) item.classList.add('watched');

  // Auto-advance after 2 seconds
  const nextIdx = (currentTrailerIdx + 1) % TRAILERS.length;
  setTimeout(() => {
    if (!isAccountLocked(currentUser)) loadTrailer(nextIdx);
  }, 2000);
}

// ── Earnings History (mock) ───────────────────────────────────────────────────
function renderEarningsHistory() {
  const tbody = document.getElementById('earnings-tbody');
  if (!tbody) return;

  const admin = getAdminData();
  const myTx  = admin.transactions
    .filter(t => t.userId === currentUser.id && (t.type === 'referral_bonus' || t.type === 'trailer_earn' || t.type === 'daily_roi'))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20);

  if (myTx.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted" style="padding:2rem">No earnings yet. Watch trailers to earn! 🎬</td></tr>`;
    return;
  }

  tbody.innerHTML = myTx.map(t => `
    <tr>
      <td data-label="Type">${typeLabel(t.type)}</td>
      <td data-label="Amount" class="text-gold">${formatZAR(t.amount)}</td>
      <td data-label="Note">${t.note || '—'}</td>
      <td data-label="Date">${formatDateTime(t.createdAt)}</td>
    </tr>
  `).join('');
}

function typeLabel(type) {
  const map = {
    referral_bonus: '👥 Referral',
    trailer_earn:   '🎬 Trailer',
    daily_roi:      '📈 Daily ROI',
    deposit:        '💳 Deposit',
    withdrawal:     '💸 Withdrawal',
  };
  return map[type] || type;
}

// ── Referral Copy ─────────────────────────────────────────────────────────────
function copyReferralCode() {
  const code = currentUser?.referralCode;
  if (!code) return;
  const link = window.location.origin + '/login.html?ref=' + code;
  navigator.clipboard?.writeText(link).then(() => {
    showToast('Referral link copied to clipboard! 📋', 'success');
  }).catch(() => {
    showToast('Your code: ' + code, 'info');
  });
}

// ── DOM Helper ────────────────────────────────────────────────────────────────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
