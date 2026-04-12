/* =============================================
   deposit.js – Subscription selection & payment
   ============================================= */

'use strict';

let currentUser     = null;
let selectedTierKey = null;

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = requireAuth();
  if (!currentUser) return;

  try {
    const data = await apiRequest('/api/user/me');
    currentUser = data.user;
    saveCurrentUser(currentUser);
  } catch (_err) { /* use cached user */ }

  renderPlanCards();
  renderCurrentSub();
  renderWalletBalance();

  document.getElementById('pay-wallet-btn')?.addEventListener('click', payWithWallet);
  document.getElementById('submit-proof-btn')?.addEventListener('click', submitProof);
  document.getElementById('modal-close')    ?.addEventListener('click', closeModal);
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
    const icon      = TIER_ICONS[key] || '🎬';
    const isFree    = tier.price === 0;
    const isPopular = key === popular;
    const maxReturn = tier.maxEarnings > 0 ? formatZAR(tier.maxEarnings) : 'N/A';

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
  const sub     = currentUser.subscription;
  const tierKey = sub?.tier;
  const tier    = tierKey ? SUBSCRIPTION_TIERS[tierKey] : null;
  const el      = document.getElementById('current-sub-info');
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

  const modal  = document.getElementById('modal-backdrop');
  const mTitle = document.getElementById('modal-plan-name');
  const mPrice = document.getElementById('modal-plan-price');
  const mIcon  = document.getElementById('modal-plan-icon');
  if (modal)  modal.classList.remove('hidden');
  if (mTitle) mTitle.textContent = tier.name;
  if (mPrice) mPrice.textContent = formatZAR(tier.price);
  if (mIcon)  mIcon.textContent  = TIER_ICONS[key] || '🎬';

  renderWalletBalance();
}

function closeModal() {
  const modal = document.getElementById('modal-backdrop');
  if (modal) modal.classList.add('hidden');
}

async function activateFreeIntern() {
  try {
    const data  = await apiRequest('/api/user/subscription', {
      method: 'POST',
      body: { tier: 'free_intern' },
    });
    currentUser = data.user;
    saveCurrentUser(currentUser);
    renderCurrentSub();
    showToast('Free Intern plan activated! 🎬', 'success');
  } catch (err) {
    showToast('Activation failed: ' + err.message, 'error');
  }
}

async function payWithWallet() {
  if (!selectedTierKey) return;
  const tier = SUBSCRIPTION_TIERS[selectedTierKey];

  if ((currentUser.wallet || 0) < tier.price) {
    showToast('Insufficient wallet balance.', 'error');
    return;
  }

  const btn = document.getElementById('pay-wallet-btn');
  if (btn) btn.disabled = true;

  try {
    const data  = await apiRequest('/api/user/subscription', {
      method: 'POST',
      body: { tier: selectedTierKey, method: 'wallet' },
    });
    currentUser = data.user;
    saveCurrentUser(currentUser);

    closeModal();
    showToast(`✅ ${tier.name} plan activated!`, 'success');
    renderCurrentSub();
    renderWalletBalance();
    renderPlanCards();
  } catch (err) {
    showToast('Payment failed: ' + err.message, 'error');
    if (btn) btn.disabled = false;
  }
}

async function submitProof() {
  if (!selectedTierKey) return;

  const tier = SUBSCRIPTION_TIERS[selectedTierKey];
  const fileInput = document.getElementById('proof-file');
  const file = fileInput?.files?.[0];

  if (!file) {
    showToast('Please upload proof of payment.', 'error');
    return;
  }

  const btn = document.getElementById('submit-proof-btn');
  if (btn) btn.disabled = true;

  try {
    const proofData = await fileToDataUrl(file);

    const data = await apiRequest('/api/deposit/initiate', {
      method: 'POST',
      body: {
        tier: selectedTierKey,
        tierName: tier.name,
        amount: tier.price,
        method: 'eft',
        proofData,
        proofName: file.name,
        proofType: file.type || 'application/octet-stream',
      },
    });

    showToast('Proof submitted successfully. Awaiting admin approval.', 'success');
    closeModal();
    fileInput.value = '';
    console.log('Deposit submitted:', data.transactionId);
  } catch (err) {
    showToast('Proof submission failed: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read proof file'));
    reader.readAsDataURL(file);
  });
}

// ── DOM Helper ───────────────────────────────────────────────────────────────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
