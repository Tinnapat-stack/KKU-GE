// Transient in-app messages, plus the state that stops budget warnings nagging.
//
// A warning that fires on every save trains the user to ignore it, so a toast is
// raised only when a category crosses UP into a higher level. The level reached is
// remembered per wallet, category and month. Dropping back down, for example after
// deleting an entry, clears it so the warning can legitimately fire again later.

const alertsKey = (accountId) => `psw_alerts_${accountId}`;
const LEVEL_RANK = { safe: 0, warn: 1, over: 2 };
const TOAST_MS = 5200;

let container = null;

function ensureContainer() {
  if (container && document.body.contains(container)) return container;
  container = document.createElement('div');
  container.className = 'toast-stack';
  document.body.appendChild(container);
  return container;
}

// tone: 'info' | 'warn' | 'over' | 'success'
export function showToast(message, tone = 'info', { icon = '' } = {}) {
  const stack = ensureContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast-${tone}`;
  toast.setAttribute('role', 'status');

  if (icon) {
    const iconEl = document.createElement('span');
    iconEl.className = 'toast-icon';
    iconEl.innerHTML = icon;
    toast.appendChild(iconEl);
  }

  const text = document.createElement('div');
  text.className = 'toast-text';
  text.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'ปิด');

  const dismiss = () => {
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.remove(), 220);
  };
  close.addEventListener('click', dismiss);

  toast.append(text, close);
  stack.appendChild(toast);

  // Let the element land before transitioning, so the entrance actually plays.
  requestAnimationFrame(() => toast.classList.add('toast-in'));
  setTimeout(dismiss, TOAST_MS);

  return toast;
}

/* ---------- Budget alert level tracking ---------- */

function readLevels(accountId) {
  try {
    return JSON.parse(localStorage.getItem(alertsKey(accountId))) || {};
  } catch {
    return {};
  }
}

function writeLevels(accountId, levels) {
  localStorage.setItem(alertsKey(accountId), JSON.stringify(levels));
}

const levelId = (walletId, category, month) => `${walletId}|${category}|${month}`;

// Records the level now reached and reports whether it is a new upward crossing.
// Returns false when the level is unchanged or lower, so the caller stays quiet.
export function crossedUpward(accountId, walletId, category, month, level) {
  const levels = readLevels(accountId);
  const key = levelId(walletId, category, month);
  const previous = levels[key] || 'safe';

  if (LEVEL_RANK[level] === LEVEL_RANK[previous]) return false;

  if (LEVEL_RANK[level] < LEVEL_RANK[previous]) {
    // Spending fell back below a threshold: forget it so it can warn again.
    if (level === 'safe') delete levels[key];
    else levels[key] = level;
    writeLevels(accountId, levels);
    return false;
  }

  levels[key] = level;
  writeLevels(accountId, levels);
  return true;
}

export function clearAlertLevels(accountId) {
  localStorage.removeItem(alertsKey(accountId));
}
