// CSV serialization and parsing for the on-disk sheet file.
// One file per account holds every record type, so an import fully restores the
// account. The BOM keeps Thai text readable when Excel opens the file.
//
// Deleted records are exported with a deleted_at stamp rather than dropped, so a
// delete made on one device is not undone by importing an older file.

import { LIMITS } from './validate.js';

const BOM = '﻿';

const COLUMNS = [
  'record',
  'id',
  'wallet_id',
  'name',
  'date',
  'type',
  'category',
  'amount',
  'note',
  'target_amount',
  'saved_amount',
  'target_date',
  'created_at',
  'updated_at',
  'deleted_at',
];

const RECORD_KINDS = new Set(['wallet', 'tx', 'goal', 'category', 'budget']);

function escapeField(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(values) {
  return COLUMNS.map((col) => escapeField(values[col])).join(',');
}

export function serializeAccount({ wallets, transactions, goals, categories, budgets }) {
  const lines = [COLUMNS.join(',')];

  for (const w of wallets) {
    lines.push(
      row({
        record: 'wallet',
        id: w.id,
        name: w.name,
        created_at: w.createdAt,
        updated_at: w.updatedAt,
        deleted_at: w.deletedAt,
      })
    );
  }

  for (const t of transactions) {
    lines.push(
      row({
        record: 'tx',
        id: t.id,
        wallet_id: t.walletId,
        date: t.date,
        type: t.type,
        category: t.category,
        amount: t.amount,
        note: t.note,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
        deleted_at: t.deletedAt,
      })
    );
  }

  for (const g of goals) {
    lines.push(
      row({
        record: 'goal',
        id: g.id,
        wallet_id: g.walletId,
        name: g.name,
        target_amount: g.targetAmount,
        saved_amount: g.savedAmount,
        target_date: g.targetDate,
        created_at: g.createdAt,
        updated_at: g.updatedAt,
        deleted_at: g.deletedAt,
      })
    );
  }

  for (const c of categories || []) {
    lines.push(
      row({
        record: 'category',
        id: c.id,
        name: c.name,
        type: c.kind,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
        deleted_at: c.deletedAt,
      })
    );
  }

  for (const b of budgets || []) {
    lines.push(
      row({
        record: 'budget',
        id: b.id,
        wallet_id: b.walletId,
        category: b.category,
        amount: b.amount,
        created_at: b.createdAt,
        updated_at: b.updatedAt,
        deleted_at: b.deletedAt,
      })
    );
  }

  return BOM + lines.join('\r\n') + '\r\n';
}

// Quote-aware parser: fields may contain commas, quotes and newlines.
function parseRows(text) {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n') {
      record.push(field);
      rows.push(record);
      record = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || record.length > 0) {
    record.push(field);
    rows.push(record);
  }

  return rows.filter((r) => r.some((cell) => cell !== ''));
}

const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function parseAmount(raw) {
  if (raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > LIMITS.AMOUNT_MAX) return null;
  return Math.round(n * 100) / 100;
}

// Returns { wallets, transactions, goals, categories, budgets, skipped } where skipped
// lists the rows that failed validation, each with its line number and reason.
// A structurally wrong file throws; a merely dirty file imports what it can.
export function parseCSV(text) {
  const rows = parseRows(text);
  if (rows.length === 0) {
    throw new Error('ไฟล์ว่างเปล่า');
  }

  const header = rows[0].map((h) => h.trim());
  const cols = {};
  for (const col of COLUMNS) cols[col] = header.indexOf(col);

  if (cols.record === -1 || cols.id === -1) {
    throw new Error('ไฟล์นี้ไม่ใช่ไฟล์ข้อมูลของ P Smart Wallet 888 (ไม่พบคอลัมน์ record หรือ id)');
  }

  const result = { wallets: [], transactions: [], goals: [], categories: [], budgets: [], skipped: [] };
  const get = (r, col) => (cols[col] === -1 ? '' : (r[cols[col]] ?? '').trim());
  const skip = (line, reason) => result.skipped.push({ line, reason });

  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const kind = get(r, 'record');
    const id = get(r, 'id');

    if (!RECORD_KINDS.has(kind)) {
      skip(line, `ไม่รู้จักชนิดข้อมูล "${kind}"`);
      return;
    }
    if (!id) {
      skip(line, 'ไม่มี id');
      return;
    }

    const base = {
      id,
      createdAt: get(r, 'created_at'),
      updatedAt: get(r, 'updated_at') || get(r, 'created_at'),
      deletedAt: get(r, 'deleted_at') || undefined,
    };

    if (kind === 'wallet') {
      const name = get(r, 'name');
      if (!name) {
        skip(line, 'กระเป๋าไม่มีชื่อ');
        return;
      }
      result.wallets.push({ ...base, name: name.slice(0, LIMITS.NAME_MAX) });
      return;
    }

    if (kind === 'tx') {
      const type = get(r, 'type');
      const date = get(r, 'date');
      const amount = parseAmount(get(r, 'amount'));

      if (type !== 'income' && type !== 'expense') {
        skip(line, `ประเภทต้องเป็น income หรือ expense แต่พบ "${type}"`);
        return;
      }
      if (!isISODate(date)) {
        skip(line, `วันที่ไม่ถูกต้อง "${date}"`);
        return;
      }
      if (amount === null || amount <= 0) {
        skip(line, `จำนวนเงินไม่ถูกต้อง "${get(r, 'amount')}"`);
        return;
      }

      result.transactions.push({
        ...base,
        walletId: get(r, 'wallet_id'),
        type,
        date,
        amount,
        category: get(r, 'category').slice(0, LIMITS.NAME_MAX) || 'อื่นๆ',
        note: get(r, 'note').slice(0, LIMITS.NOTE_MAX),
      });
      return;
    }

    if (kind === 'goal') {
      const name = get(r, 'name');
      const target = parseAmount(get(r, 'target_amount'));
      const saved = parseAmount(get(r, 'saved_amount'));

      if (!name) {
        skip(line, 'เป้าหมายไม่มีชื่อ');
        return;
      }
      if (target === null || target <= 0) {
        skip(line, `จำนวนเงินเป้าหมายไม่ถูกต้อง "${get(r, 'target_amount')}"`);
        return;
      }
      if (saved === null) {
        skip(line, `ยอดที่เก็บได้ไม่ถูกต้อง "${get(r, 'saved_amount')}"`);
        return;
      }

      const targetDate = get(r, 'target_date');
      result.goals.push({
        ...base,
        walletId: get(r, 'wallet_id'),
        name: name.slice(0, LIMITS.NAME_MAX),
        targetAmount: target,
        savedAmount: saved,
        targetDate: isISODate(targetDate) ? targetDate : '',
      });
      return;
    }

    if (kind === 'budget') {
      const category = get(r, 'category');
      const amount = parseAmount(get(r, 'amount'));

      if (!category) {
        skip(line, 'งบประมาณไม่มีหมวดหมู่');
        return;
      }
      if (amount === null || amount <= 0) {
        skip(line, `จำนวนเงินงบประมาณไม่ถูกต้อง "${get(r, 'amount')}"`);
        return;
      }

      result.budgets.push({
        ...base,
        walletId: get(r, 'wallet_id'),
        category: category.slice(0, LIMITS.NAME_MAX),
        amount,
      });
      return;
    }

    // kind === 'category'
    const name = get(r, 'name');
    const catKind = get(r, 'type');
    if (!name) {
      skip(line, 'หมวดหมู่ไม่มีชื่อ');
      return;
    }
    if (catKind !== 'income' && catKind !== 'expense') {
      skip(line, `ชนิดหมวดหมู่ไม่ถูกต้อง "${catKind}"`);
      return;
    }
    result.categories.push({ ...base, kind: catKind, name: name.slice(0, LIMITS.NAME_MAX) });
  });

  const total =
    result.wallets.length +
    result.transactions.length +
    result.goals.length +
    result.categories.length +
    result.budgets.length;

  if (total === 0) {
    const reason = result.skipped.length
      ? `ทุกแถวมีปัญหา เช่น บรรทัด ${result.skipped[0].line}: ${result.skipped[0].reason}`
      : 'ไม่พบข้อมูลในไฟล์';
    throw new Error(`นำเข้าไม่ได้ ${reason}`);
  }

  return result;
}
