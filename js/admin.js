/* =============================================
   admin.js – Admin panel: withdrawals, txns, users
   ============================================= */

'use strict';

let adminUser = null;

document.addEventListener('DOMContentLoaded', () => {
  adminUser = requireAdmin();
  if (!adminUser) return;

  renderAdminStats();
  switchAdminTab('withdrawals');

  document.getElementById('demo-data-btn')?.addEventListener('click', seedAdminDemoData);

  // Tab buttons
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchAdminTab(btn.dataset.tab));
  });
});

// ── Tab Switching ─────────────────────────────────────────────────────────────
function switchAdminTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tabId));

  if (tabId === 'withdrawals')   renderWithdrawals();
  else if (tabId === 'transactions') renderTransactions();
  else if (tabId === 'users')    renderUsers();
}

// ── Stats Overview ────────────────────────────────────────────────────────────
function renderAdminStats() {
  const admin = getAdminData();
  const users = getUsers().filter(u => !u.isAdmin);

  const pendingW  = admin.withdrawals.filter(w => w.status === 'pending').length;
  const pendingT  = admin.transactions.filter(t => t.status === 'pending' && t.type === 'deposit').length;
  const totalW    = admin.withdrawals.reduce((s, w) => s + (w.amount || 0), 0);
  const activeU   = users.filter(u => {
    const tier = getActiveTier(u);
    return tier && tier.price > 0;
  }).length;

  setEl('stat-pending-w',   pendingW);
  setEl('stat-pending-t',   pendingT);
  setEl('stat-total-users', users.length);
  setEl('stat-active-subs', activeU);
  setEl('stat-total-w-vol', formatZAR(totalW));
}

// ── Withdrawals Table ─────────────────────────────────────────────────────────
function renderWithdrawals() {
  const admin  = getAdminData();
  const tbody  = document.getElementById('withdrawals-tbody');
  if (!tbody) return;

  const sorted = [...admin.withdrawals].sort((a, b) => b.createdAt - a.createdAt);

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding:2rem">No withdrawal requests yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map(w => `
    <tr id="wrow-${w.id}">
      <td data-label="User">
        <div class="user-cell">
          <div class="user-avatar">${(w.username || 'U')[0].toUpperCase()}</div>
          <div>
            <div class="user-name">${w.username || '—'}</div>
            <div class="user-email">${w.email || '—'}</div>
          </div>
        </div>
      </td>
      <td data-label="Amount">${formatZAR(w.amount)}</td>
      <td data-label="Fee" class="text-red">- ${formatZAR(w.fee)}</td>
      <td data-label="Net" class="text-green">${formatZAR(w.net)}</td>
      <td data-label="Method">${w.method || '—'}</td>
      <td data-label="Date">${formatDateTime(w.createdAt)}</td>
      <td data-label="Status"><span class="badge badge-${w.status}"><span class="badge-dot"></span>${w.status}</span></td>
      <td data-label="Actions">
        ${w.status === 'pending' ? `
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">
            <button class="btn btn-success btn-sm" onclick="approveWithdrawal('${w.id}')">✅ Approve</button>
            <button class="btn btn-danger btn-sm"  onclick="rejectWithdrawal('${w.id}')">✗ Reject</button>
          </div>
        ` : `<span class="text-muted" style="font-size:.8rem">—</span>`}
      </td>
    </tr>
  `).join('');
}

function approveWithdrawal(id) {
  const admin = getAdminData();
  const w     = admin.withdrawals.find(x => x.id === id);
  if (!w || w.status !== 'pending') return;

  w.status     = 'approved';
  w.processedAt = Date.now();
  saveAdminData(admin);

  // Update transaction log
  const txIdx = admin.transactions.findIndex(t => t.userId === w.userId && t.type === 'withdrawal' && t.status === 'pending');
  if (txIdx >= 0) {
    admin.transactions[txIdx].status = 'approved';
    saveAdminData(admin);
  }

  renderWithdrawals();
  renderAdminStats();
  showToast(`✅ Withdrawal of ${formatZAR(w.amount)} approved for ${w.username}.`, 'success');
}

function rejectWithdrawal(id) {
  const admin = getAdminData();
  const w     = admin.withdrawals.find(x => x.id === id);
  if (!w || w.status !== 'pending') return;

  w.status     = 'rejected';
  w.processedAt = Date.now();

  // Refund wallet
  const users = getUsers();
  const user  = users.find(u => u.id === w.userId);
  if (user) {
    user.wallet = parseFloat(((user.wallet || 0) + w.amount).toFixed(2));
    saveUsers(users);
    const cur = getCurrentUser();
    if (cur && cur.id === user.id) saveCurrentUser(user);
  }

  saveAdminData(admin);
  renderWithdrawals();
  renderAdminStats();
  showToast(`Withdrawal rejected and ${formatZAR(w.amount)} refunded to ${w.username}.`, 'warning');
}

// ── Transactions Table ────────────────────────────────────────────────────────
function renderTransactions() {
  const admin  = getAdminData();
  const tbody  = document.getElementById('transactions-tbody');
  if (!tbody) return;

  const deposits = admin.transactions
    .filter(t => t.type === 'deposit')
    .sort((a, b) => b.createdAt - a.createdAt);

  if (deposits.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:2rem">No transactions yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = deposits.map(t => `
    <tr id="trow-${t.id}">
      <td data-label="User">
        <div class="user-cell">
          <div class="user-avatar">${(t.username || 'U')[0].toUpperCase()}</div>
          <div>
            <div class="user-name">${t.username || getUsernameById(t.userId)}</div>
            <div class="user-email">${t.email    || getEmailById(t.userId)}</div>
          </div>
        </div>
      </td>
      <td data-label="Plan">${TIER_ICONS[t.tier] || '🎬'} ${t.tierName || t.note || '—'}</td>
      <td data-label="Amount">${formatZAR(t.amount)}</td>
      <td data-label="Method">${t.method === 'yoco' ? '💳 Yoco' : '👛 Wallet'}</td>
      <td data-label="Date">${formatDateTime(t.createdAt)}</td>
      <td data-label="Status"><span class="badge badge-${t.status}"><span class="badge-dot"></span>${t.status}</span></td>
      <td data-label="Actions">
        ${t.status === 'pending' ? `
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">
            <button class="btn btn-success btn-sm" onclick="verifyTransaction('${t.id}')">✅ Verify</button>
            <button class="btn btn-danger btn-sm"  onclick="rejectTransaction('${t.id}')">✗ Reject</button>
          </div>
        ` : `<span class="text-muted" style="font-size:.8rem">—</span>`}
      </td>
    </tr>
  `).join('');
}

function verifyTransaction(id) {
  const admin = getAdminData();
  const tx    = admin.transactions.find(t => t.id === id);
  if (!tx || tx.status !== 'pending') return;

  tx.status      = 'approved';
  tx.processedAt = Date.now();
  saveAdminData(admin);

  // Activate user subscription
  const users = getUsers();
  const user  = users.find(u => u.id === tx.userId);
  if (user && tx.tier) {
    const tier = SUBSCRIPTION_TIERS[tx.tier];
    const now  = Date.now();
    user.subscription = {
      tier:        tx.tier,
      activatedAt: now,
      expiresAt:   now + (tier?.durationDays || 30) * 86400000,
    };
    user.totalEarned  = 0;
    user.lastEarningsProcessed = now;
    saveUsers(users);
    creditReferralBonuses(user, tx.amount);
  }

  renderTransactions();
  renderAdminStats();
  showToast(`✅ Transaction verified. Subscription activated for user.`, 'success');
}

function rejectTransaction(id) {
  const admin = getAdminData();
  const tx    = admin.transactions.find(t => t.id === id);
  if (!tx || tx.status !== 'pending') return;

  tx.status      = 'rejected';
  tx.processedAt = Date.now();
  saveAdminData(admin);

  renderTransactions();
  renderAdminStats();
  showToast('Transaction rejected.', 'warning');
}

// ── Users Table ───────────────────────────────────────────────────────────────
function renderUsers() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  const users = getUsers().filter(u => !u.isAdmin).sort((a, b) => b.createdAt - a.createdAt);

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:2rem">No users registered yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => {
    const tierKey  = u.subscription?.tier || 'free_intern';
    const tier     = SUBSCRIPTION_TIERS[tierKey];
    const active   = getActiveTier(u);
    const locked   = isAccountLocked(u);
    return `
      <tr>
        <td data-label="User">
          <div class="user-cell">
            <div class="user-avatar">${u.username[0].toUpperCase()}</div>
            <div>
              <div class="user-name">${u.username}</div>
              <div class="user-email">${u.email}</div>
            </div>
          </div>
        </td>
        <td data-label="Wallet"     class="text-gold">${formatZAR(u.wallet || 0)}</td>
        <td data-label="Earned"     class="text-green">${formatZAR(u.totalEarned || 0)}</td>
        <td data-label="Referrals">${formatZAR(u.referralEarnings || 0)}</td>
        <td data-label="Plan">
          <span class="badge ${active && tier?.price > 0 ? 'badge-active' : 'badge-free'}">
            ${TIER_ICONS[tierKey] || '🎬'} ${tier?.name || 'None'}
          </span>
        </td>
        <td data-label="Status">
          ${locked
            ? '<span class="badge badge-rejected">🔒 Capped</span>'
            : active && tier?.price > 0
              ? '<span class="badge badge-approved">Active</span>'
              : '<span class="badge badge-free">Free</span>'
          }
        </td>
        <td data-label="Joined">${formatDate(u.createdAt)}</td>
      </tr>
    `;
  }).join('');
}

// ── Demo Data Seeder ──────────────────────────────────────────────────────────
function seedAdminDemoData() {
  const now   = Date.now();
  const users = getUsers();

  // Add sample withdrawals & transactions if none exist
  const admin = getAdminData();

  if (admin.withdrawals.length === 0) {
    const demoUser = users.find(u => u.email === 'demo@clipcash.co.za');
    if (demoUser) {
      admin.withdrawals.push(
        { id: generateId(), userId: demoUser.id, username: demoUser.username, email: demoUser.email, amount: 200, fee: 20, net: 180, method: 'bank_transfer', account: '****1234', status: 'pending', createdAt: now - 3600000 },
        { id: generateId(), userId: demoUser.id, username: demoUser.username, email: demoUser.email, amount: 500, fee: 50, net: 450, method: 'bank_transfer', account: '****1234', status: 'approved', processedAt: now - 86400000, createdAt: now - 2 * 86400000 }
      );
      admin.transactions.push(
        { id: generateId(), userId: demoUser.id, username: demoUser.username, email: demoUser.email, type: 'deposit', tier: 'gold', tierName: 'Gold', amount: 5000, method: 'yoco', status: 'pending', note: 'Yoco payment pending', createdAt: now - 7200000 }
      );
      saveAdminData(admin);
    }
  }

  renderAdminStats();
  switchAdminTab('withdrawals');
  showToast('Demo data loaded! 🎉', 'success');
}

// ── Lookup Helpers ────────────────────────────────────────────────────────────
function getUsernameById(id) {
  return getUsers().find(u => u.id === id)?.username || '—';
}
function getEmailById(id) {
  return getUsers().find(u => u.id === id)?.email || '—';
}

// ── DOM Helper ────────────────────────────────────────────────────────────────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
