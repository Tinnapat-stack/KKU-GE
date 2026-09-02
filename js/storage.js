// localStorage layer: account registry, session, and per-account data.
// Data is scoped account -> wallet. Transactions and goals both carry a walletId.
//
// Deletes are soft: a record gets a deletedAt stamp and is filtered out of reads.
// That way a CSV import cannot resurrect something the user already deleted.
// Tombstones older than LIMITS.TOMBSTONE_DAYS are purged at login.

import { LIMITS } from './validate.js';

const KEY_ACCOUNTS = 'psw_accounts';
const KEY_SESSION = 'psw_session';
const dataKey = (accountId) => `psw_data_${accountId}`;
const dirtyKey = (accountId) => `psw_dirty_${accountId}`;

const EMPTY_DATA = { wallets: [], transactions: [], goals: [], categories: [], budgets: [] };

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function now() {
  return new Date().toISOString();
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const alive = (list) => list.filter((r) => !r.deletedAt);

/* ---------- Accounts ---------- */

export function getAccounts() {
  return readJSON(KEY_ACCOUNTS, []);
}

export function findAccountsByUsername(username) {
  const target = (username || '').trim().toLowerCase();
  return getAccounts().filter((a) => a.username.toLowerCase() === target);
}

export function createAccount({ username, salt, hash, iterations, hint }) {
  const accounts = getAccounts();
  const stamp = now();
  const account = {
    id: uid(),
    username: username.trim(),
    salt,
    hash,
    iterations,
    hint: (hint || '').trim(),
    createdAt: stamp,
  };
  accounts.push(account);
  writeJSON(KEY_ACCOUNTS, accounts);

  const wallet = { id: uid(), name: 'กระเป๋าหลัก', createdAt: stamp, updatedAt: stamp };
  writeJSON(dataKey(account.id), { ...EMPTY_DATA, wallets: [wallet] });

  return { account, wallet };
}

export function getAccountById(id) {
  return getAccounts().find((a) => a.id === id) || null;
}

/* ---------- Session ---------- */

export function getSession() {
  return readJSON(KEY_SESSION, null);
}

export function setSession(accountId, walletId) {
  writeJSON(KEY_SESSION, { accountId, walletId });
}

export function clearSession() {
  localStorage.removeItem(KEY_SESSION);
}

/* ---------- Dirty flag ---------- */
// Set before a file sync is scheduled and cleared once the write lands. If the tab
// closes mid-debounce the flag survives, and the next login re-syncs the file.
// localStorage itself is written synchronously, so user data is never at risk.

export function markDirty(accountId) {
  localStorage.setItem(dirtyKey(accountId), '1');
}

export function clearDirty(accountId) {
  localStorage.removeItem(dirtyKey(accountId));
}

export function isDirty(accountId) {
  return localStorage.getItem(dirtyKey(accountId)) === '1';
}

/* ---------- Account data blob ---------- */

export function getData(accountId) {
  return { ...EMPTY_DATA, ...readJSON(dataKey(accountId), EMPTY_DATA) };
}

export function saveData(accountId, data) {
  writeJSON(dataKey(accountId), data);
}

// Physically drops tombstones that are old enough that no other device could
// still be carrying an un-merged copy of the record.
export function purgeTombstones(accountId) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LIMITS.TOMBSTONE_DAYS);
  const cutoffISO = cutoff.toISOString();
  const keep = (r) => !r.deletedAt || r.deletedAt > cutoffISO;

  const data = getData(accountId);
  const count = (d) =>
    d.wallets.length + d.transactions.length + d.goals.length + d.categories.length + d.budgets.length;
  const before = count(data);

  data.wallets = data.wallets.filter(keep);
  data.transactions = data.transactions.filter(keep);
  data.goals = data.goals.filter(keep);
  data.categories = data.categories.filter(keep);
  data.budgets = data.budgets.filter(keep);

  const after = count(data);
  if (after !== before) saveData(accountId, data);
}

/* ---------- Wallets ---------- */

export function getWallets(accountId) {
  return alive(getData(accountId).wallets);
}

export function addWallet(accountId, name) {
  const data = getData(accountId);
  const stamp = now();
  const wallet = { id: uid(), name: name.trim(), createdAt: stamp, updatedAt: stamp };
  data.wallets.push(wallet);
  saveData(accountId, data);
  return wallet;
}

export function renameWallet(accountId, walletId, name) {
  const data = getData(accountId);
  const wallet = data.wallets.find((w) => w.id === walletId);
  if (wallet) {
    wallet.name = name.trim();
    wallet.updatedAt = now();
    saveData(accountId, data);
  }
}

// Tombstones the wallet along with every transaction and goal inside it.
export function deleteWallet(accountId, walletId) {
  const data = getData(accountId);
  const stamp = now();
  const kill = (r) => {
    r.deletedAt = stamp;
    r.updatedAt = stamp;
  };

  data.wallets.filter((w) => w.id === walletId).forEach(kill);
  data.transactions.filter((t) => t.walletId === walletId && !t.deletedAt).forEach(kill);
  data.goals.filter((g) => g.walletId === walletId && !g.deletedAt).forEach(kill);
  data.budgets.filter((b) => b.walletId === walletId && !b.deletedAt).forEach(kill);
  saveData(accountId, data);
}

/* ---------- Transactions ---------- */

export function getTransactions(accountId, walletId) {
  const list = alive(getData(accountId).transactions);
  return walletId ? list.filter((t) => t.walletId === walletId) : list;
}

export function addTransaction(accountId, tx) {
  const data = getData(accountId);
  const stamp = now();
  const record = { id: uid(), createdAt: stamp, updatedAt: stamp, ...tx };
  data.transactions.push(record);
  saveData(accountId, data);
  return record;
}

export function updateTransaction(accountId, id, patch) {
  const data = getData(accountId);
  data.transactions = data.transactions.map((t) =>
    t.id === id ? { ...t, ...patch, updatedAt: now() } : t
  );
  saveData(accountId, data);
}

export function deleteTransaction(accountId, id) {
  updateTransaction(accountId, id, { deletedAt: now() });
}

/* ---------- Goals ---------- */

export function getGoals(accountId, walletId) {
  const list = alive(getData(accountId).goals);
  return walletId ? list.filter((g) => g.walletId === walletId) : list;
}

export function addGoal(accountId, goal) {
  const data = getData(accountId);
  const stamp = now();
  const record = { id: uid(), createdAt: stamp, updatedAt: stamp, savedAmount: 0, ...goal };
  data.goals.push(record);
  saveData(accountId, data);
  return record;
}

export function updateGoal(accountId, id, patch) {
  const data = getData(accountId);
  data.goals = data.goals.map((g) => (g.id === id ? { ...g, ...patch, updatedAt: now() } : g));
  saveData(accountId, data);
}

export function deleteGoal(accountId, id) {
  updateGoal(accountId, id, { deletedAt: now() });
}

/* ---------- Custom categories ---------- */
// Typing a category under "อื่นๆ" saves it so it becomes a real button next time.

export function getCustomCategories(accountId, kind) {
  const list = alive(getData(accountId).categories);
  return kind ? list.filter((c) => c.kind === kind) : list;
}

export function addCustomCategory(accountId, kind, name) {
  const clean = name.trim();
  if (!clean) return null;

  const data = getData(accountId);
  const existing = alive(data.categories).find(
    (c) => c.kind === kind && c.name.toLowerCase() === clean.toLowerCase()
  );
  if (existing) return existing;

  const stamp = now();
  const record = { id: uid(), kind, name: clean, createdAt: stamp, updatedAt: stamp };
  data.categories.push(record);

  // Keep the grid manageable by dropping the oldest once the cap is passed.
  const ofKind = alive(data.categories).filter((c) => c.kind === kind);
  if (ofKind.length > LIMITS.MAX_CUSTOM_CATEGORIES) {
    ofKind
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, ofKind.length - LIMITS.MAX_CUSTOM_CATEGORIES)
      .forEach((c) => {
        c.deletedAt = stamp;
        c.updatedAt = stamp;
      });
  }

  saveData(accountId, data);
  return record;
}

export function deleteCustomCategory(accountId, id) {
  const data = getData(accountId);
  const stamp = now();
  data.categories = data.categories.map((c) =>
    c.id === id ? { ...c, deletedAt: stamp, updatedAt: stamp } : c
  );
  saveData(accountId, data);
}

/* ---------- Budgets ---------- */
// A budget is a recurring monthly ceiling for one expense category, or for the
// wallet as a whole under the TOTAL_BUDGET sentinel. At most one live budget per
// wallet and category pair, so setting one twice edits rather than duplicates.

export const TOTAL_BUDGET = '__TOTAL__';

export function getBudgets(accountId, walletId) {
  const list = alive(getData(accountId).budgets);
  return walletId ? list.filter((b) => b.walletId === walletId) : list;
}

export function setBudget(accountId, { walletId, category, amount }) {
  const data = getData(accountId);
  const stamp = now();
  const existing = data.budgets.find(
    (b) => !b.deletedAt && b.walletId === walletId && b.category === category
  );

  if (existing) {
    existing.amount = amount;
    existing.updatedAt = stamp;
    saveData(accountId, data);
    return existing;
  }

  const record = { id: uid(), walletId, category, amount, createdAt: stamp, updatedAt: stamp };
  data.budgets.push(record);
  saveData(accountId, data);
  return record;
}

export function deleteBudget(accountId, id) {
  const data = getData(accountId);
  const stamp = now();
  data.budgets = data.budgets.map((b) =>
    b.id === id ? { ...b, deletedAt: stamp, updatedAt: stamp } : b
  );
  saveData(accountId, data);
}

/* ---------- Import merge ---------- */

const stampOf = (r) => r.updatedAt || r.createdAt || '';

// Last write wins by updatedAt. A tie keeps the local copy so a re-import of an
// unchanged file is a no-op. Returns per-collection counts for the confirm dialog.
function mergeList(existing, incoming) {
  const byId = new Map(existing.map((r) => [r.id, r]));
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const record of incoming) {
    const current = byId.get(record.id);
    if (!current) {
      byId.set(record.id, record);
      added++;
    } else if (stampOf(record) > stampOf(current)) {
      byId.set(record.id, { ...current, ...record });
      updated++;
    } else {
      skipped++;
    }
  }

  return { list: Array.from(byId.values()), added, updated, skipped };
}

// Dry run: returns what an import would do, without touching stored data.
export function previewImport(accountId, imported) {
  const data = getData(accountId);
  const wallets = mergeList(data.wallets, imported.wallets);
  const transactions = mergeList(data.transactions, imported.transactions);
  const goals = mergeList(data.goals, imported.goals);
  const categories = mergeList(data.categories, imported.categories || []);
  const budgets = mergeList(data.budgets, imported.budgets || []);
  const all = [wallets, transactions, goals, categories, budgets];

  return {
    added: all.reduce((n, r) => n + r.added, 0),
    updated: all.reduce((n, r) => n + r.updated, 0),
    unchanged: all.reduce((n, r) => n + r.skipped, 0),
  };
}

export function mergeImported(accountId, imported, replace = false) {
  if (replace) {
    saveData(accountId, {
      wallets: imported.wallets,
      transactions: imported.transactions,
      goals: imported.goals,
      categories: imported.categories || [],
      budgets: imported.budgets || [],
    });
    return;
  }

  const data = getData(accountId);
  data.wallets = mergeList(data.wallets, imported.wallets).list;
  data.transactions = mergeList(data.transactions, imported.transactions).list;
  data.goals = mergeList(data.goals, imported.goals).list;
  data.categories = mergeList(data.categories, imported.categories || []).list;
  data.budgets = mergeList(data.budgets, imported.budgets || []).list;
  saveData(accountId, data);
}

// Records whose wallet is missing would otherwise vanish from the UI, so they are
// collected into a recovery wallet instead.
export function rehomeOrphans(accountId) {
  const data = getData(accountId);
  const walletIds = new Set(alive(data.wallets).map((w) => w.id));
  const orphans = [...data.transactions, ...data.goals, ...data.budgets].filter(
    (r) => !r.deletedAt && !walletIds.has(r.walletId)
  );
  if (orphans.length === 0) return 0;

  const stamp = now();
  const recovery = { id: uid(), name: 'รายการที่กู้คืน', createdAt: stamp, updatedAt: stamp };
  data.wallets.push(recovery);
  for (const record of orphans) {
    record.walletId = recovery.id;
    record.updatedAt = stamp;
  }
  saveData(accountId, data);
  return orphans.length;
}
