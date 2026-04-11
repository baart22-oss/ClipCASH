/* =============================================
   dashboard.js – Trailer viewer, ROI, earnings
   ============================================= */

'use strict';

// ── Mock Trailer Playlist ─────────────────────────────────────────────────────
const TRAILERS = [
  { id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up',  genre: 'Music Video',  year: 1987 },
  { id: 'L_jWHffIx5E', title: 'Smells Like Teen Spirit',  genre: 'Music',        year: 1991 },
  { id: 'kJQP7kiw5Fk', title: 'Despacito',                genre: 'Pop',          year: 2017 },
  { id: 'RgKAFK5djSk', title: 'See You Again',             genre: 'Drama / R&B', year: 2015 },
  { id: 'JGwWNGJdvx8', title: 'Shape of You',              genre: 'Pop',          year: 2017 },
];

let currentTrailerIdx = 0;
let timerInterval     = null;
let timerSeconds      = 15;
let timerRunning      = false;
let currentUser       = null;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  currentUser = requireAuth();
  if (!currentUser) return;

  // Fetch fresh user data from backend to reflect any server-side updates
  // (e.g. pending ROI credited on login, subscription changes).
  try {
    const data = await apiRequest('/api/user/me');
    currentUser = data.user;
    saveCurrentUser(currentUser);
  } catch (_err) {
    // If backend is unreachable, continue with the cached user.
  }

  renderDashboard();
  renderPlaylist();
  loadTrailer(0);
  checkAccountLock();
  renderEarningsHistory();
});

// ── Dashboard Stats ───────────────────────────────────────────────────────────
function renderDashboard() {
  const tier    = getActiveTier(currentUser);
  const tierKey = currentUser.subscription?.tier || 'free_intern';

  setEl('stat-wallet',       formatZAR(currentUser.wallet));
  setEl('stat-total-earned', formatZAR(currentUser.totalEarned));
  setEl('stat-daily',        formatZAR(calculateDailyEarnings(currentUser)));
  setEl('stat-sub',          (TIER_ICONS[tierKey] || '🎬') + ' ' + (SUBSCRIPTION_TIERS[tierKey]?.name || 'Free Intern'));

  renderSubCard();
  renderCapProgress();

  setEl('referral-code-display', currentUser.referralCode || '—');
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
  const tierKey = currentUser.subscription?.tier;
  const tier    = tierKey ? SUBSCRIPTION_TIERS[tierKey] : null;
  const earned  = currentUser.totalEarned || 0;
  const cap     = tier?.maxEarnings || 0;
  const pct     = cap > 0 ? Math.min((earned / cap) * 100, 100) : 0;

  const bar        = document.getElementById('cap-bar-fill');
  const capLabel   = document.getElementById('cap-progress-label');
  const capCurrent = document.getElementById('cap-current');
  const capMax     = document.getElementById('cap-max');

  if (bar)        bar.style.width        = pct.toFixed(1) + '%';
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
  if (isAccountLocked(currentUser)) { checkAccountLock(); return; }

  stopTimer();
  currentTrailerIdx = idx;
  const trailer = TRAILERS[idx];

  const iframe = document.getElementById('trailer-iframe');
  if (iframe) {
    iframe.src = `https://www.youtube.com/embed/${trailer.id}?autoplay=1&mute=1&rel=0&modestbranding=1`;
  }

  setEl('trailer-title', trailer.title);
  setEl('trailer-genre', trailer.genre + ' · ' + trailer.year);

  const bar = document.getElementById('trailer-progress');
  if (bar) bar.style.width = '0%';

  document.querySelectorAll('.playlist-item').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });

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

async function onTrailerComplete() {
  if (isAccountLocked(currentUser)) { checkAccountLock(); return; }

  const trailer   = TRAILERS[currentTrailerIdx];
  const earning   = calculatePerTrailerEarning(currentUser);
  const tier      = getActiveTier(currentUser);
  const cap       = tier?.maxEarnings || 0;
  const remaining = cap - (currentUser.totalEarned || 0);

  const today = new Date().toISOString().slice(0, 10);
  const dailyCap = tier ? parseFloat((tier.price * tier.dailyROI).toFixed(4)) : 0;
  const dailyEarnings = currentUser.dailyEarningsDate === today
    ? (currentUser.dailyEarnings || 0)
    : 0;
  const dailyClipsWatched = currentUser.dailyEarningsDate === today
    ? (currentUser.dailyClipsWatched || 0)
    : 0;

  if (earning <= 0 || remaining <= 0 || (dailyCap > 0 && dailyEarnings >= dailyCap) || dailyClipsWatched >= 10) {
    if (cap === 0) showToast('Upgrade your plan to earn while watching!', 'info');
    else if (dailyCap > 0 && dailyEarnings >= dailyCap) showToast('Daily earnings cap reached. Come back tomorrow.', 'info');
    else if (dailyClipsWatched >= 10) showToast('Daily clip limit reached. Come back tomorrow.', 'info');
    else checkAccountLock();

    // Still mark as watched locally
    if (!currentUser.watchedTrailers) currentUser.watchedTrailers = [];
    if (!currentUser.watchedTrailers.includes(trailer.id)) {
      currentUser.watchedTrailers.push(trailer.id);
      saveCurrentUser(currentUser);
      try {
        await apiRequest('/api/user/me', { method: 'PATCH', body: { watchedTrailers: currentUser.watchedTrailers } });
      } catch (_e) { /* non-critical */ }
    }
    renderPlaylist();
    scheduleNextTrailer();
    return;
  }

  try {
    const data = await apiRequest('/api/user/earnings', {
      method: 'POST',
      body: {
        amount:       earning,
        trailerId:    trailer.id,
        trailerTitle: trailer.title,
      },
    });

    const credited = data.credited || 0;
    // Sync local cache with server response
    currentUser = data.user;
    saveCurrentUser(currentUser);

    if (credited > 0) {
      showToast(`🎉 Earned ${formatZAR(credited)} for watching "${trailer.title}"!`, 'success');
    }
  } catch (err) {
    // Optimistic local update so the UI isn't stuck if backend is temporarily unreachable
    const creditedAmount = Math.min(earning, remaining);
    currentUser.wallet      = parseFloat(((currentUser.wallet || 0) + creditedAmount).toFixed(4));
    currentUser.totalEarned = parseFloat(((currentUser.totalEarned || 0) + creditedAmount).toFixed(4));
    if (!currentUser.watchedTrailers) currentUser.watchedTrailers = [];
    if (!currentUser.watchedTrailers.includes(trailer.id)) currentUser.watchedTrailers.push(trailer.id);
    currentUser.lastEarningsProcessed = Date.now();
    saveCurrentUser(currentUser);
    showToast(`🎉 Earned ${formatZAR(creditedAmount)} (offline — will sync on reconnect).`, 'warning');
    console.warn('[Dashboard] earnings API error:', err.message);
  }

  renderDashboard();
  renderPlaylist();
  checkAccountLock();

  const item = document.getElementById(`playlist-item-${currentTrailerIdx}`);
  if (item) item.classList.add('watched');

  scheduleNextTrailer();
}

function scheduleNextTrailer() {
  const nextIdx = (currentTrailerIdx + 1) % TRAILERS.length;
  setTimeout(() => {
    if (!isAccountLocked(currentUser)) loadTrailer(nextIdx);
  }, 2000);
}

// ── Earnings History ──────────────────────────────────────────────────────────
async function renderEarningsHistory() {
  const tbody = document.getElementById('earnings-tbody');
  if (!tbody) return;

  try {
    const data = await apiRequest('/api/user/transactions');
    const myTx = (data.transactions || [])
      .filter(t => ['referral_bonus', 'trailer_earn', 'daily_roi'].includes(t.type))
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
  } catch (_err) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted" style="padding:2rem">Could not load earnings history.</td></tr>`;
  }
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
