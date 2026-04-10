/* =============================================
   deposit.js – Subscription selection & payment
   ============================================= */

'use strict';

let currentUser     = null;
let selectedTierKey = null;

document.addEventListener('DOMContentLoaded', () => {
  currentUser = requireAuth();
  if (!currentUser) return;

  renderPlanCards();
  renderCurrentSub();
  renderWalletBalance();

  document.getElementById('pay-wallet-btn')?.addEventListener('click', payWithWallet);
  document.getElementById('pay-yoco-btn')  ?.addEventListener('click', payWithYoco);
  document.getElementById('modal-close')   ?.addEventListener('click', closeModal);
  document.getElementById('modal-backdrop')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
});

// ── Render Plan Cards ─────────────────────────────────────────────────────────
function renderPlanCards() {
  const grid = document.getElementById('plans-grid');
  if (!grid) return;

  const tiers   = Object.entries(SUBSCRIPTION_TIERS);
  const popular = 'gold';

  grid.innerHTML = tiers.map(([key, tier]) => {
    const icon       = TIER_ICONS[key] || '🎬';
    const isFree     = tier.price === 0;
    const isPopular  = key === popular;
    const maxReturn  = tier.maxEarnings > 0 ? formatZAR(tier.maxEarnings) : 'N/A';

    return `
      <div class="plan-card ${isPopular ? 'popular' : ''}" id="plan-${key}" onclick="selectPlan('${key}')">
        <div class="plan-select-check" id="check-${key}"></div>
        ${isPopular ? '<span class="plan-badge">Most Popular</span>' : ''}
        <div class="plan-name">${icon} ${tier.name}</div>
        <div class="plan-price">
          ${isFree ? 'Free' : formatZAR(tier.price)}
          ${!isFree ? '<span>/ once off</span>' : ''}
        </div>
        <div class="plan-roi">
          ${tier.dailyROI > 0 ? '📈 ' + (tier.dailyROI * 100) + '% daily ROI' : '0% ROI — Free Trial'}
        </div>
        <div class="plan-features">
          <div class="plan-feature">
            <span class="check">✓</span>
            <span>${tier.durationDays}-day access</span>
          </div>
          <div class="plan-feature">
            <span class="${tier.maxEarnings > 0 ? 'check' : 'cross'}">${tier.maxEarnings > 0 ? '✓' : '✗'}</span>
            <span>Max earnings: ${maxReturn}</span>
          </div>
          <div class="plan-feature">
            <span class="${tier.dailyROI > 0 ? 'check' : 'cross'}">${tier.dailyROI > 0 ? '✓' : '✗'}</span>
            <span>Daily ROI earnings</span>
          </div>
          <div class="plan-feature">
            <span class="check">✓</span>
            <span>Watch trailers &amp; earn</span>
          </div>
          <div class="plan-feature">
            <span class="check">✓</span>
            <span>Referral bonuses</span>
          </div>
        </div>
        <button class="btn btn-primary w-full mt-3" onclick="event.stopPropagation(); selectAndPay('${key}')">
          ${isFree ? 'Activate Free Plan' : 'Select Plan'}
        </button>
      </div>
    `;
  }).join('');
}

function renderCurrentSub() {
  const sub      = currentUser.subscription;
  const tierKey  = sub?.tier;
  const tier     = tierKey ? SUBSCRIPTION_TIERS[tierKey] : null;
  const el       = document.getElementById('current-sub-info');
  if (!el) return;

  if (!sub || !tier) {
    el.innerHTML = `<p class="text-muted">No active subscription.</p>`;
    return;
  }
  el.innerHTML = `
    <div class="sub-tier-name">${TIER_ICONS[tierKey] || '🎬'} ${tier.name}</div>
    <div class="sub-details">
      <div class="sub-detail-item">
        <label>Activated</label>
        <span>${formatDate(sub.activatedAt)}</span>
      </div>
      <div class="sub-detail-item">
        <label>Expires</label>
        <span>${sub.expiresAt ? formatDate(sub.expiresAt) : '—'}</span>
      </div>
      <div class="sub-detail-item">
        <label>Daily ROI</label>
        <span class="text-green">${(tier.dailyROI * 100).toFixed(0)}%</span>
      </div>
      <div class="sub-detail-item">
        <label>Max Earnings</label>
        <span class="text-gold">${tier.maxEarnings > 0 ? formatZAR(tier.maxEarnings) : 'N/A'}</span>
      </div>
    </div>
  `;
}

function renderWalletBalance() {
  setEl('wallet-balance-display', formatZAR(currentUser.wallet || 0));
}

// ── Plan Selection ────────────────────────────────────────────────────────────
function selectPlan(key) {
  selectedTierKey = key;

  document.querySelectorAll('.plan-card').forEach(c => {
    c.classList.remove('selected');
    const check = c.querySelector('.plan-select-check');
    if (check) check.textContent = '';
  });

  const card  = document.getElementById('plan-' + key);
  const check = document.getElementById('check-' + key);
  if (card)  card.classList.add('selected');
  if (check) check.textContent = '✓';
}

function selectAndPay(key) {
  selectPlan(key);
  const tier = SUBSCRIPTION_TIERS[key];

  if (key === 'free_intern') {
    activateFreeIntern();
    return;
  }

  // Open payment modal
  const modal = document.getElementById('modal-backdrop');
  const mTitle = document.getElementById('modal-plan-name');
  const mPrice = document.getElementById('modal-plan-price');
  const mIcon  = document.getElementById('modal-plan-icon');
  if (modal)  modal.classList.remove('hidden');
  if (mTitle) mTitle.textContent = tier.name;
  if (mPrice) mPrice.textContent = formatZAR(tier.price);
  if (mIcon)  mIcon.textContent  = TIER_ICONS[key] || '🎬';

  renderWalletBalance();
  const walletBal = currentUser.wallet || 0;
  const walletBtn = document.getElementById('pay-wallet-btn');
  if (walletBtn) {
    walletBtn.disabled = walletBal < tier.price;
    walletBtn.title    = walletBal < tier.price ? 'Insufficient wallet balance' : '';
    walletBtn.textContent = walletBal < tier.price
      ? `Wallet Balance Insufficient (${formatZAR(walletBal)})`
      : `Pay with Wallet (${formatZAR(walletBal)})`;
  }
}

function activateFreeIntern() {
  const now  = Date.now();
  currentUser.subscription = {
    tier:        'free_intern',
    activatedAt: now,
    expiresAt:   now + 3 * 86400000,
  };
  updateUserInStore(currentUser);
  renderCurrentSub();
  showToast('Free Intern plan activated! Watch trailers to explore. 🎬', 'success');
}

function closeModal() {
  const modal = document.getElementById('modal-backdrop');
  if (modal) modal.classList.add('hidden');
}

// ── Payment Methods ───────────────────────────────────────────────────────────
function payWithWallet() {
  if (!selectedTierKey) return;
  const tier  = SUBSCRIPTION_TIERS[selectedTierKey];
  const price = tier.price;

  if ((currentUser.wallet || 0) < price) {
    showToast('Insufficient wallet balance.', 'error');
    return;
  }

  const now = Date.now();
  currentUser.wallet = parseFloat(((currentUser.wallet || 0) - price).toFixed(2));
  currentUser.subscription = {
    tier:        selectedTierKey,
    activatedAt: now,
    expiresAt:   now + tier.durationDays * 86400000,
  };
  currentUser.totalEarned = 0; // Reset for new plan cycle
  currentUser.lastEarningsProcessed = now;
  updateUserInStore(currentUser);

  // Credit referral bonuses
  creditReferralBonuses(currentUser, price);

  // Log transaction
  addTransaction(currentUser.id, 'deposit', price, tier.name + ' plan via Wallet', 'approved');

  closeModal();
  showToast(`✅ ${tier.name} plan activated! Earning starts now.`, 'success');
  renderCurrentSub();
  renderWalletBalance();
  renderPlanCards();
}

async function payWithYoco() {
  if (!selectedTierKey) return;
  const tier = SUBSCRIPTION_TIERS[selectedTierKey];

  const btn = document.getElementById('pay-yoco-btn');
  if (btn) btn.disabled = true;

  try {
    // Create a pending deposit transaction on the backend.
    // The transaction stays pending until the Yoco webhook fires (payment.succeeded)
    // or an admin verifies it via the admin panel.
    await apiRequest('/api/deposit/initiate', {
      method: 'POST',
      body: {
        userId:   currentUser.id,
        username: currentUser.username,
        email:    currentUser.email,
        tier:     selectedTierKey,
        tierName: tier.name,
        amount:   tier.price,
        method:   'yoco',
      },
    });

    closeModal();
    showToast(`💳 Yoco payment initiated for ${tier.name}. Admin will verify shortly.`, 'info', 6000);

    // In production this would redirect to the Yoco payment page returned by the backend.
    // window.location.href = data.checkoutUrl;
  } catch (err) {
    showToast('Failed to initiate payment: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── DOM Helper ────────────────────────────────────────────────────────────────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
