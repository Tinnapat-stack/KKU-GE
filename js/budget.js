// Budget maths and the alert level model.
//
// A budget is a recurring monthly ceiling. Levels drive every colour and message
// in the feature, so they are defined once here and nowhere else.

import { getBudgets, getTransactions, TOTAL_BUDGET } from './storage.js';
import { toISODate } from './validate.js';

export { TOTAL_BUDGET };

export const WARN_AT = 70;
export const OVER_AT = 100;

export const LEVEL_LABELS = {
  safe: 'ยังอยู่ในงบ',
  warn: 'ใกล้เกินงบ',
  over: 'เกินงบแล้ว',
};

export function levelFor(percent) {
  if (percent >= OVER_AT) return 'over';
  if (percent >= WARN_AT) return 'warn';
  return 'safe';
}

// Start and end of the calendar month containing `date`, as ISO strings.
export function monthBounds(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start: toISODate(start), end: toISODate(end) };
}

// Expenses this month for one category, or every expense for the total sentinel.
export function monthSpend(transactions, category, date = new Date()) {
  const { start, end } = monthBounds(date);
  return transactions
    .filter(
      (t) =>
        t.type === 'expense' &&
        t.date >= start &&
        t.date <= end &&
        (category === TOTAL_BUDGET || t.category === category)
    )
    .reduce((sum, t) => sum + t.amount, 0);
}

function buildRow(budget, transactions, date) {
  const spent = monthSpend(transactions, budget.category, date);
  const limit = budget.amount;
  const percent = limit > 0 ? (spent / limit) * 100 : 0;

  return {
    id: budget.id,
    category: budget.category,
    isTotal: budget.category === TOTAL_BUDGET,
    limit,
    spent,
    remaining: limit - spent,
    percent,
    level: levelFor(percent),
  };
}

// Every budget for the wallet, riskiest first, with the wallet total separated out
// so callers can pin it to the top rather than sorting it among the categories.
export function budgetStatus(accountId, walletId, date = new Date()) {
  // A transfer is not spending, so it must never eat a budget.
  const transactions = getTransactions(accountId, walletId, { includeTransfers: false });
  const budgets = getBudgets(accountId, walletId);

  const rows = budgets.map((b) => buildRow(b, transactions, date));
  const total = rows.find((r) => r.isTotal) || null;
  const categories = rows
    .filter((r) => !r.isTotal)
    .sort((a, b) => b.percent - a.percent);

  return { total, categories, all: total ? [total, ...categories] : categories };
}

// The single row for one category, or null when no budget is set for it. Used by
// the entry form to show the remaining budget before the user commits a spend.
export function budgetForCategory(accountId, walletId, category, date = new Date()) {
  const budget = getBudgets(accountId, walletId).find((b) => b.category === category);
  if (!budget) return null;
  return buildRow(budget, getTransactions(accountId, walletId, { includeTransfers: false }), date);
}
