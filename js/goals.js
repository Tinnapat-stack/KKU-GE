// Saving goals: the daily plan, the progress, and what happens when the money is
// finally spent.
//
// The rule that shapes everything here: setting money aside is not a transaction.
// The cash never left the wallet, the user only decided what it is for. If a deposit
// were recorded as an expense, the balance would drop twice — once on the day it was
// set aside and again on the day it was actually spent. So deposits live in their own
// ledger and only the payout at the end becomes a real expense.

import { getGoals, savedFor, getSavings, addTransaction, updateGoal } from './storage.js';
import { toISODate, todayISO } from './validate.js';

const MS_PER_DAY = 86400000;

export const STATUS = { SAVING: 'saving', REACHED: 'reached', DONE: 'done' };

const parseISO = (iso) => new Date(`${iso}T00:00:00`);

// Whole days between two ISO dates, counting both ends. A goal due today still has
// one day left to save in, not zero.
export function daysBetween(fromISO, toISO) {
  return Math.round((parseISO(toISO) - parseISO(fromISO)) / MS_PER_DAY) + 1;
}

// What to put aside each day to arrive on time. Rounded up, because rounding down
// leaves the goal a few baht short on the last day.
export function perDayFor(amount, fromISO, toISO) {
  const days = daysBetween(fromISO, toISO);
  if (!(days > 0) || !(amount > 0)) return 0;
  return Math.ceil(amount / days);
}

// Everything the goal card and the calendar need, derived rather than stored, so a
// deposit edited or removed cannot leave a stale number behind.
export function goalProgress(accountId, goal) {
  const saved = savedFor(accountId, goal.id);
  const target = goal.targetAmount || 0;
  const remaining = Math.max(0, target - saved);
  const today = todayISO();
  const reached = saved >= target && target > 0;

  const daysLeft = goal.targetDate ? daysBetween(today, goal.targetDate) : 0;
  const overdue = !!goal.targetDate && goal.targetDate < today && !reached;

  return {
    saved,
    target,
    remaining,
    percent: target ? Math.min(100, (saved / target) * 100) : 0,
    reached,
    overdue,
    daysLeft: Math.max(0, daysLeft),
    // The original plan is what the user agreed to follow. The catch-up rate is what
    // today actually demands, which is the number that matters once a day is missed.
    planPerDay: goal.planPerDay || 0,
    catchUpPerDay: goal.targetDate && daysLeft > 0 ? perDayFor(remaining, today, goal.targetDate) : 0,
    status: statusOf(goal, saved),
  };
}

// A goal reaches its target the moment the money is there, deadline or not. It only
// becomes done when the user says they have spent it.
export function statusOf(goal, saved) {
  if (goal.status === STATUS.DONE) return STATUS.DONE;
  return saved >= (goal.targetAmount || 0) && goal.targetAmount > 0
    ? STATUS.REACHED
    : STATUS.SAVING;
}

// The last `days` days ending today, each with what was put aside and whether that
// met the plan. Drives the little streak strip on the card.
export function recentDays(accountId, goal, days = 7) {
  const deposits = new Map(getSavings(accountId, goal.id).map((s) => [s.date, s.amount]));
  const plan = goal.planPerDay || 0;
  const out = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));

  for (let i = 0; i < days; i++) {
    const date = toISODate(cursor);
    const amount = deposits.get(date) || 0;
    out.push({ date, amount, met: plan > 0 ? amount >= plan : amount > 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

// Goals still being saved into, with a deadline, are the ones the calendar shows.
export function savingGoals(accountId, walletId) {
  return getGoals(accountId, walletId).filter((g) => {
    if (g.status === STATUS.DONE || !g.targetDate) return false;
    return savedFor(accountId, g.id) < (g.targetAmount || 0);
  });
}

// Spending what was saved is the only moment a goal touches the ledger. The expense
// is real: it belongs in the statistics and counts against the category's budget like
// any other. The goal keeps the transaction id so the two can be traced to each other.
export function payOutGoal(accountId, goal, { amount, category, sub, date }) {
  const tx = addTransaction(accountId, {
    walletId: goal.walletId,
    type: 'expense',
    amount,
    quantity: 1,
    category,
    sub: sub || '',
    note: `ใช้เงินจากเป้าหมาย "${goal.name}"`,
    date: date || todayISO(),
    fromGoal: goal.id,
  });

  updateGoal(accountId, goal.id, {
    status: STATUS.DONE,
    spendCategory: category,
    spendSub: sub || '',
    paidTxId: tx.id,
    paidAt: tx.date,
  });

  return tx;
}
