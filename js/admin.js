/* =============================================
   admin.js – Admin panel: auth + backend API calls
   ============================================= */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  initAdminPage();
});

// ── Admin page bootstrap ──────────────────────────────────────────────────────
async function initAdminPage() {
  const token = getAdminToken();

  if (token) {
    // Validate the stored token by fetching stats
    try {
      await loadAdminStats();
      showAdminContent();
    } catch (err) {
      if (err.status === 401) {
        clearAdminToken();
        showLoginModal();
      } else {
        showToast('Failed to connect to backend: ' + err.message, 'error');
        showAdminContent(); // show UI even if backend unreachable
      }
    }
  } else {
    showLoginModal();
  }

  // Tab buttons
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchAdminTab(btn.dataset.tab));
  });

  // Demo data button (syncs localStorage demo data to backend)
  document.getElementById('demo-data-btn')?.addEventListener('click', seedAdminDemoData);
}

// ── Admin login modal ─────────────────────────────────────────────────────────
function showLoginModal() {
  document.getElementById('admin-content')?.classList.add('hidden');
  const modal = document.getElementById('admin-login-modal');
  if (modal) modal.classList.remove('hidden');

  const form = document.getElementById('admin-login-form');
  if (form) form.addEventListener('submit', handleAdminLogin, { once: true });
}

function hideLoginModal() {
  const modal = document.getElementById('admin-login-modal');
  if (modal) modal.classList.add('hidden');
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const username = document.getElementById('admin-username')?.value.trim() || '';
  const password = document.getElementById('admin-password')?.value || '';
  const btn      = document.getElementById('admin-login-btn');
  const errorEl  = document.getElementById('admin-login-error');

  if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('show'); }
  if (btn) btn.disabled = true;

  try {
    const data = await apiRequest('/api/admin/login', {
      method: 'POST',
      body: { username, password },
    });
    setAdminToken(data.token);
    hideLoginModal();
    showAdminContent();
    await loadAdminStats();
    switchAdminTab('withdrawals');
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.status === 401
        ? 'Incorrect username or password.'
        : 'Login failed: ' + err.message;
      errorEl.classList.add('show');
    }
    const form = document.getElementById('admin-login-form');
    if (form) form.addEventListener('submit', handleAdminLogin, { once: true });
  } finally {
    if (btn) btn.disabled = false;
  }
}

function showAdminContent() {
  document.getElementById('admin-content')?.classList.remove('hidden');
  switchAdminTab('withdrawals');
}

// ── Tab Switching ─────────────────────────────────────────────────────────────
function switchAdminTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tabId));

  if (tabId === 'withdrawals')        renderWithdrawals();
  else if (tabId === 'transactions')  renderTransactions();
  else if (tabId === 'users')         renderUsers();
}

// ── Stats Overview ────────────────────────────────────────────────────────────
async function loadAdminStats() {
  const data = await apiRequest('/api/admin/stats');
  setEl('stat-pending-w',   data.pendingWithdrawals   || 0);
  setEl('stat-pending-t',   data.pendingTransactions  || 0);
  setEl('stat-total-users', data.totalUsers           || 0);
  setEl('stat-active-subs', data.activeSubscriptions  || 0);
  setEl('stat-total-w-vol', formatZAR(data.totalWithdrawalVolume || 0));
  return data;
}

function renderAdminStats() {
  loadAdminStats().catch(err => showToast('Stats error: ' + err.message, 'error'));
}

// ── Withdrawals Table ─────────────────────────────────────────────────────────
async function renderWithdrawals() {
  const tbody = document.getElementById('withdrawals-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding:2rem">Loading…</td></tr>`;

  try {
    const data   = await apiRequest('/api/admin/withdrawals');
    const sorted = [...(data.withdrawals || [])].sort((a, b) => b.createdAt - a.createdAt);

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
              <button class="btn btn-success btn-sm" onclick="approveWithdrawal('${w.id}')">&#x2705; Approve</button>
              <button class="btn btn-danger btn-sm"  onclick="rejectWithdrawal('${w.id}')">&#x2717; Reject</button>
            </div>
          ` : `<span class="text-muted" style="font-size:.8rem">—</span>`}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding:2rem">Error loading withdrawals: ${err.message}</td></tr>`;
  }
}

async function approveWithdrawal(id) {
  try {
    const data = await apiRequest('/api/admin/process-withdrawal', {
      method: 'POST',
      body: { withdrawalId: id, action: 'approve' },
    });
    renderWithdrawals();
    renderAdminStats();
    showToast('Withdrawal approved: ' + formatZAR(data.withdrawal?.amount || 0) + '.', 'success');
  } catch (err) {
    showToast('Approve failed: ' + err.message, 'error');
  }
}

async function rejectWithdrawal(id) {
  try {
    const data = await apiRequest('/api/admin/process-withdrawal', {
      method: 'POST',
      body: { withdrawalId: id, action: 'reject' },
    });
    renderWithdrawals();
    renderAdminStats();
    showToast('Withdrawal rejected and refunded: ' + formatZAR(data.withdrawal?.amount || 0) + '.', 'warning');
  } catch (err) {
    showToast('Reject failed: ' + err.message, 'error');
  }
}

// ── Transactions Table ────────────────────────────────────────────────────────
async function renderTransactions() {
  const tbody = document.getElementById('transactions-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:2rem">Loading…</td></tr>`;

  try {
    const data    = await apiRequest('/api/admin/transactions');
    const deposits = [...(data.transactions || [])]
      .filter(t => t.type === 'deposit')
      .sort((a, b) => b.createdAt - a.createdAt);

    if (deposits.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:2rem">No deposit transactions yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = deposits.map(t => `
      <tr id="trow-${t.id}">
        <td data-label="User">
          <div class="user-cell">
            <div class="user-avatar">${(t.username || 'U')[0].toUpperCase()}</div>
            <div>
              <div class="user-name">${t.username || '—'}</div>
              <div class="user-email">${t.email    || '—'}</div>
            </div>
          </div>
        </td>
        <td data-label="Plan">${TIER_ICONS[t.tier] || '&#x1F3AC;'} ${t.tierName || t.note || '—'}</td>
        <td data-label="Amount">${formatZAR(t.amount)}</td>
        <td data-label="Method">${t.method === 'yoco' ? '&#x1F4B3; Yoco' : '&#x1F45B; Wallet'}</td>
        <td data-label="Date">${formatDateTime(t.createdAt)}</td>
        <td data-label="Status"><span class="badge badge-${t.status}"><span class="badge-dot"></span>${t.status}</span></td>
        <td data-label="Actions">
          ${t.status === 'pending' ? `
            <div style="display:flex;gap:.4rem;flex-wrap:wrap">
              <button class="btn btn-success btn-sm" onclick="verifyTransaction('${t.id}')">&#x2705; Verify</button>
              <button class="btn btn-danger btn-sm"  onclick="rejectTransaction('${t.id}')">&#x2717; Reject</button>
            </div>
          ` : `<span class="text-muted" style="font-size:.8rem">—</span>`}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:2rem">Error loading transactions: ${err.message}</td></tr>`;
  }
}

async function verifyTransaction(id) {
  try {
    await apiRequest('/api/admin/verify-transaction', {
      method: 'POST',
      body: { transactionId: id, action: 'approve' },
    });
    renderTransactions();
    renderAdminStats();
    showToast('Transaction verified. Subscription activated for user.', 'success');
  } catch (err) {
    showToast('Verify failed: ' + err.message, 'error');
  }
}

async function rejectTransaction(id) {
  try {
    await apiRequest('/api/admin/verify-transaction', {
      method: 'POST',
      body: { transactionId: id, action: 'reject' },
    });
    renderTransactions();
    renderAdminStats();
    showToast('Transaction rejected.', 'warning');
  } catch (err) {
    showToast('Reject failed: ' + err.message, 'error');
  }
}

// ── Users Table ───────────────────────────────────────────────────────────────
async function renderUsers() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:2rem">Loading…</td></tr>`;

  try {
    const data  = await apiRequest('/api/admin/users');
    const users = (data.users || []).filter(u => !u.isAdmin).sort((a, b) => b.createdAt - a.createdAt);

    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:2rem">No users registered yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = users.map(u => {
      const tierKey = u.subscription?.tier || u.subscriptionTier || 'free_intern';
      const tier    = SUBSCRIPTION_TIERS[tierKey];
      const active  = u.subscriptionActive || (u.subscription?.expiresAt > Date.now());
      return `
        <tr>
          <td data-label="User">
            <div class="user-cell">
              <div class="user-avatar">${(u.username || 'U')[0].toUpperCase()}</div>
              <div>
                <div class="user-name">${u.username || '—'}</div>
                <div class="user-email">${u.email || '—'}</div>
              </div>
            </div>
          </td>
          <td data-label="Wallet"     class="text-gold">${formatZAR(u.wallet || u.walletBalance || 0)}</td>
          <td data-label="Earned"     class="text-green">${formatZAR(u.totalEarned || 0)}</td>
          <td data-label="Referrals">${formatZAR(u.referralEarnings || 0)}</td>
          <td data-label="Plan">
            <span class="badge ${active && tier?.price > 0 ? 'badge-active' : 'badge-free'}">
              ${TIER_ICONS[tierKey] || '&#x1F3AC;'} ${tier?.name || 'None'}
            </span>
          </td>
          <td data-label="Status">
            ${active && tier?.price > 0
              ? '<span class="badge badge-approved">Active</span>'
              : '<span class="badge badge-free">Free</span>'
            }
          </td>
          <td data-label="Joined">${formatDate(u.createdAt)}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:2rem">Error loading users: ${err.message}</td></tr>`;
  }
}

// ── Demo Data Seeder (syncs localStorage demo data to backend) ─────────────────
async function seedAdminDemoData() {
  try {
    const users     = getUsers();
    const adminData = getAdminData();
    await apiRequest('/api/admin/sync', {
      method: 'POST',
      body: {
        users,
        withdrawals:  adminData.withdrawals,
        transactions: adminData.transactions,
      },
    });
    renderAdminStats();
    switchAdminTab('withdrawals');
    showToast('Demo data synced to backend! 🎉', 'success');
  } catch (err) {
    showToast('Sync failed: ' + err.message, 'error');
  }
}

// ── DOM Helper ───────────────────────────────────────────────────────────���────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
