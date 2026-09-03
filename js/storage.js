// localStorage layer: account registry, session, and per-account data.
// Data is scoped account -> wallet. Transactions and goals both carry a walletId.
//
// Deletes are soft: a record gets a deletedAt stamp and is filtered out of reads.
// That way a CSV import cannot resurrect something the user already deleted.
// Tombstones older than LIMITS.TOMBSTONE_DAYS are purged at login.

import { LIMITS } from './validate.js';
import { isBuiltInCategory } from './categories.js';

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

// A password is optional. The blueprint calls for no password at all, so username
// alone is the default path and a password is an opt-in extra for shared machines.
// Older accounts already carry a hash, so hasPassword derives from it and no data
// migration is needed.
export function createAccount({ username, salt, hash, iterations, hint, seedWallet = true }) {
  const accounts = getAccounts();
  const stamp = now();
  const account = {
    id: uid(),
    username: username.trim(),
    salt: salt || '',
    hash: hash || '',
    iterations: iterations || 0,
    hint: (hint || '').trim(),
    createdAt: stamp,
  };
  accounts.push(account);
  writeJSON(KEY_ACCOUNTS, accounts);

  // Importing a file brings its own wallets, so seeding one here would leave the
  // account with a spare empty wallet it never asked for.
  const wallets = seedWallet
    ? [{ id: uid(), name: 'กระเป๋าหลัก', createdAt: stamp, updatedAt: stamp }]
    : [];
  writeJSON(dataKey(account.id), { ...EMPTY_DATA, wallets });

  return { account, wallet: wallets[0] || null };
}

export function accountHasPassword(account) {
  return !!(account && account.hash);
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

// Records written before subcategories existed have no parent. A record named after
// a built-in becomes that built-in's own settings; anything else stands alone. This
// runs on every read and is safe to repeat, because it only fills a missing field.
function withParents(list) {
  for (const c of list) {
    if (c.parent === undefined) {
      c.parent = isBuiltInCategory(c.kind, c.name) ? c.name : '';
    }
  }
  return list;
}

export function getData(accountId) {
  const data = { ...EMPTY_DATA, ...readJSON(dataKey(accountId), EMPTY_DATA) };
  withParents(data.categories);
  return data;
}

export function saveData(accountId, data) {
  writeJSON(dataKey(accountId), data);
}

// Categories written before V1.4.1 carry no parent. Filling it in on read is not
// enough on its own: the CSV writer reads the raw data, and exporting a record with
// an empty parent would turn a built-in's settings into a standalone category named
// after that built-in, which draws a duplicate button on the next import. So the
// normalisation is written back once, at login.
export function migrateCategories(accountId) {
  const raw = readJSON(dataKey(accountId), null);
  if (!raw || !Array.isArray(raw.categories)) return 0;

  const missing = raw.categories.filter((c) => c.parent === undefined).length;
  if (missing === 0) return 0;

  saveData(accountId, getData(accountId));
  return missing;
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

/* ---------- Categories ---------- */
// Categories are two levels. A main category is one of the built-in list and exists
// in code, not in storage. Every stored record is a SUBCATEGORY of one of them, or a
// standalone category the user made up.
//
//   parent  the main category it belongs to, or '' when it belongs to none
//   name    what the button says; when the user leaves it blank it becomes the parent
//
// The unit cost and the pin live down here rather than on the main category, because
// one main category holds many things at many prices, which is exactly the problem
// this level solves.
//
// A subcategory whose name equals its parent is not a second button: it IS the main
// category's own cost and pin. That one rule is what keeps the entry grid from
// showing the same category twice, and makes the older single-cost behaviour a
// special case of this model rather than a second mechanism.

export const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// True for the record that carries a main category's own settings.
export const isSelfRecord = (c) => !!c.parent && sameName(c.parent, c.name);

function categoryRecords(accountId) {
  return withParents(alive(getData(accountId).categories));
}

// Every category the entry grid draws: subcategories and standalone ones, but not
// the records that only hold a main category's own settings.
export function getCustomCategories(accountId, kind) {
  const list = categoryRecords(accountId).filter((c) => !isSelfRecord(c));
  return kind ? list.filter((c) => c.kind === kind) : list;
}

// Subcategories of one main category, in creation order so the grid is stable.
export function getSubcategories(accountId, kind, parent) {
  return categoryRecords(accountId)
    .filter((c) => c.kind === kind && sameName(c.parent, parent) && !isSelfRecord(c))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// The cost and pin of every stored record, keyed by "parent|name" so a main
// category's own settings and a subcategory of the same name never collide.
export const prefKey = (parent, name) => `${parent || ''}|${name}`;

export function getCategoryPrefs(accountId, kind) {
  const map = new Map();
  for (const c of categoryRecords(accountId)) {
    if (kind && c.kind !== kind) continue;
    map.set(prefKey(c.parent, c.name), { cost: c.cost || 0, pinned: !!c.pinned });
  }
  return map;
}

// What a transaction should record for a category. A main category's own settings
// carry no subcategory name, so a row never reads "ยา · ยา".
export function categoryTarget(record) {
  const parent = record.parent || '';
  return {
    category: parent || record.name,
    sub: parent && !sameName(parent, record.name) ? record.name : '',
  };
}

export function getPinnedCategories(accountId, kind) {
  return categoryRecords(accountId)
    .filter((c) => c.pinned && (!kind || c.kind === kind))
    .map((c) => ({
      kind: c.kind,
      parent: c.parent || '',
      name: c.name,
      cost: c.cost || 0,
      ...categoryTarget(c),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

// Finds the record for a parent and name, creating it on the first setting stored
// against it. Used by the cost writer, the pin writer and the subcategory form.
function upsertCategory(data, kind, parent, name, patch) {
  const stamp = now();
  withParents(data.categories);
  const existing = alive(data.categories).find(
    (c) => c.kind === kind && sameName(c.parent, parent || '') && sameName(c.name, name)
  );

  if (existing) {
    Object.assign(existing, patch, { updatedAt: stamp });
    return existing;
  }

  const record = {
    id: uid(),
    kind,
    parent: parent || '',
    name,
    cost: 0,
    pinned: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...patch,
  };
  data.categories.push(record);
  return record;
}

export function setCategoryCost(accountId, kind, parent, name, cost) {
  const data = getData(accountId);
  const record = upsertCategory(data, kind, parent, name, {
    cost: Math.max(0, Number(cost) || 0),
  });
  saveData(accountId, data);
  return record;
}

export function setCategoryPinned(accountId, kind, parent, name, pinned) {
  const data = getData(accountId);
  const record = upsertCategory(data, kind, parent, name, { pinned: !!pinned });
  saveData(accountId, data);
  return record;
}

// A subcategory with no name of its own takes the parent's, which is how the user
// says "this main category, at this price".
export function addSubcategory(accountId, kind, parent, name, cost = 0) {
  const clean = String(name || '').trim() || parent;
  if (!parent || !clean) return { ok: false, error: 'ต้องเลือกหมวดหลักก่อน' };

  const data = getData(accountId);
  withParents(data.categories);
  const clash = alive(data.categories).find(
    (c) => c.kind === kind && sameName(c.parent, parent) && sameName(c.name, clean)
  );
  if (clash) {
    return {
      ok: false,
      error:
        clean === parent
          ? `หมวด "${parent}" มีราคาของตัวเองอยู่แล้ว ถ้าจะเพิ่มอีกอันให้ตั้งชื่อหมวดย่อยด้วย`
          : `มีหมวดย่อยชื่อ "${clean}" ใน "${parent}" อยู่แล้ว`,
    };
  }

  const record = upsertCategory(data, kind, parent, clean, {
    cost: Math.max(0, Number(cost) || 0),
  });
  saveData(accountId, data);
  return { ok: true, record };
}

// Typing a category on the entry form. With no parent it stands on its own; with one
// it becomes a subcategory, which is the "carry on from an existing category" case.
export function addCustomCategory(accountId, kind, name, parent = '') {
  const clean = name.trim();
  if (!clean) return null;

  // Standing a category on its own under a built-in's name would draw a duplicate
  // button, so it is refused rather than quietly accepted.
  if (!parent && isBuiltInCategory(kind, clean)) return null;

  const data = getData(accountId);
  withParents(data.categories);
  const existing = alive(data.categories).find(
    (c) => c.kind === kind && sameName(c.parent, parent || '') && sameName(c.name, clean)
  );
  if (existing) return existing;

  const stamp = now();
  const record = {
    id: uid(),
    kind,
    parent: parent || '',
    name: clean,
    cost: 0,
    pinned: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  data.categories.push(record);

  // Keep the grid manageable by dropping the oldest once the cap is passed. A main
  // category's own settings take no room in the grid, so they do not count.
  const ofKind = alive(data.categories).filter((c) => c.kind === kind && !isSelfRecord(c));
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

// Which transactions belong to one stored category record. A main category's own
// settings match the rows with no subcategory; a subcategory matches its own rows;
// a standalone category matches by name.
function matchesRecord(t, record) {
  if (record.parent) {
    if (t.category !== record.parent) return false;
    return isSelfRecord(record) ? !t.sub : t.sub === record.name;
  }
  return t.category === record.name;
}

// How many live transactions still use this category, so the confirm prompt can
// say what is about to change.
export function countCategoryUsage(accountId, record) {
  return alive(getData(accountId).transactions).filter((t) => matchesRecord(t, record)).length;
}

// Deleting a category must not leave old records meaningless.
//
// A standalone category is the only case that rewrites history: its transactions and
// budgets go from "น้ำมัน" to "อื่นๆ (น้ำมัน)" so nothing loses its meaning and the
// budget keeps tracking instead of silently vanishing.
//
// A subcategory rewrites nothing. Its transactions still name a main category that
// exists, and the subcategory label they carry still reads correctly in the history.
// A main category's own settings cannot be deleted at all, only cleared.
export function deleteCustomCategory(accountId, id) {
  const data = getData(accountId);
  const stamp = now();
  withParents(data.categories);
  const target = data.categories.find((c) => c.id === id);
  if (!target) return { renamedTransactions: 0, renamedBudgets: 0 };

  if (isSelfRecord(target)) {
    target.cost = 0;
    target.pinned = false;
    target.updatedAt = stamp;
    saveData(accountId, data);
    return { renamedTransactions: 0, renamedBudgets: 0 };
  }

  data.categories = data.categories.map((c) =>
    c.id === id ? { ...c, deletedAt: stamp, updatedAt: stamp } : c
  );

  if (target.parent) {
    saveData(accountId, data);
    return { renamedTransactions: 0, renamedBudgets: 0 };
  }

  const from = target.name;
  const to = `อื่นๆ (${from})`;
  let renamedTransactions = 0;
  let renamedBudgets = 0;

  data.transactions = data.transactions.map((t) => {
    if (t.deletedAt || t.category !== from) return t;
    renamedTransactions++;
    return { ...t, category: to, updatedAt: stamp };
  });

  data.budgets = data.budgets.map((b) => {
    if (b.deletedAt || b.category !== from) return b;
    renamedBudgets++;
    return { ...b, category: to, updatedAt: stamp };
  });

  saveData(accountId, data);
  return { renamedTransactions, renamedBudgets };
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
