import { describe, expect, it } from 'vitest';
import type { InventoryItemView, InventoryLog, InventoryTransactionType } from '@/shared/types';
import {
  countByStatus, countLogsBySource, dailyConsumption, filterLogsBySource, filterStock, formatLogReference, logSourceOf, makeAdjustSchema,
  stockStatus,
} from './model';

const item = (name: string, inStock: number, reserved: number, reorder: number): InventoryItemView => ({
  id: 1, branchId: 1, ingredientId: 1, quantityInStock: inStock, reservedQuantity: reserved, reorderLevel: reorder, averageCost: 100, version: 1,
  updatedAt: '2026-10-30T08:00:00', ingredientName: name, unit: 'g', available: inStock - reserved, isLow: inStock - reserved <= reorder,
});

let nextId = 1;
const log = (type: InventoryTransactionType, qty: number, createdAt: string): InventoryLog => ({
  id: nextId++, branchId: 1, ingredientId: 1, transactionType: type, quantityChanged: qty, balanceAfter: 0, createdAt,
});

describe('stockStatus', () => {
  it('available ≤ 0 → Hết hàng (kể cả âm)', () => {
    expect(stockStatus(0, 100)).toBe('out');
    expect(stockStatus(-5, 100)).toBe('out');
  });
  it('0 < available ≤ ngưỡng → Sắp hết (gồm đúng bằng ngưỡng)', () => {
    expect(stockStatus(1, 100)).toBe('low');
    expect(stockStatus(100, 100)).toBe('low');
  });
  it('available > ngưỡng → Ổn', () => {
    expect(stockStatus(101, 100)).toBe('ok');
  });
  it('đếm theo trạng thái dựa trên available, không phải tồn kho', () => {
    // tồn 500 nhưng đang giữ 450 → khả dụng 50 ≤ 100 → sắp hết
    const counts = countByStatus([item('A', 500, 450, 100), item('B', 300, 300, 100), item('C', 900, 0, 100)]);
    expect(counts).toEqual({ out: 1, low: 1, ok: 1 });
  });
});

describe('filterStock', () => {
  const items = [item('Cà phê hạt Robusta', 9000, 0, 1000), item('Sữa đặc', 600, 100, 1000), item('Trân châu', 100, 100, 500)];

  it('tìm không phân biệt hoa thường và dấu tiếng Việt', () => {
    expect(filterStock(items, { q: 'CA PHE', lowOnly: false }).map((i) => i.ingredientName)).toEqual(['Cà phê hạt Robusta']);
    expect(filterStock(items, { q: 'tran chau', lowOnly: false })).toHaveLength(1);
    expect(filterStock(items, { q: 'đặc', lowOnly: false })).toHaveLength(1);
  });
  it('lowOnly giữ cả Sắp hết và Hết hàng', () => {
    expect(filterStock(items, { q: '', lowOnly: true }).map((i) => i.ingredientName)).toEqual(['Sữa đặc', 'Trân châu']);
  });
  it('kết hợp q + lowOnly; không khớp → rỗng', () => {
    expect(filterStock(items, { q: 'cà phê', lowOnly: true })).toEqual([]);
  });
});

describe('gom nhóm nguồn log', () => {
  it('map đúng 6 loại giao dịch vào 3 nhóm', () => {
    expect(logSourceOf('Auto_Deduct')).toBe('auto');
    expect(logSourceOf('Refund')).toBe('auto');
    expect(logSourceOf('Import')).toBe('import');
    expect(logSourceOf('Adjustment')).toBe('manual');
    expect(logSourceOf('Waste')).toBe('manual');
    expect(logSourceOf('Stocktake')).toBe('manual');
  });
  it('lọc và đếm theo nhóm', () => {
    const logs = [
      log('Auto_Deduct', -10, '2026-10-30T01:00:00Z'), log('Refund', 5, '2026-10-30T02:00:00Z'), log('Import', 100, '2026-10-29T01:00:00Z'),
      log('Waste', -3, '2026-10-29T02:00:00Z'), log('Stocktake', -1, '2026-10-28T01:00:00Z'),
    ];
    expect(filterLogsBySource(logs, 'all')).toHaveLength(5);
    expect(filterLogsBySource(logs, 'auto').map((l) => l.transactionType)).toEqual(['Auto_Deduct', 'Refund']);
    expect(filterLogsBySource(logs, 'import')).toHaveLength(1);
    expect(filterLogsBySource(logs, 'manual')).toHaveLength(2);
    expect(countLogsBySource(logs)).toEqual({ all: 5, auto: 2, import: 1, manual: 2 });
  });
});

describe('dailyConsumption', () => {
  // Dùng giờ địa phương để test không phụ thuộc múi giờ máy chạy
  const now = new Date(2026, 9, 30, 15, 0, 0);
  const at = (daysAgo: number, hour = 12) => new Date(2026, 9, 30 - daysAgo, hour, 0, 0).toISOString();

  it('luôn đủ 7 ngày từ cũ → mới, kết thúc ở hôm nay', () => {
    const days = dailyConsumption([], now);
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.label)).toEqual(['24/10', '25/10', '26/10', '27/10', '28/10', '29/10', '30/10']);
    expect(days.every((d) => d.value === 0)).toBe(true);
  });
  it('cộng Auto_Deduct, trừ Refund, bỏ qua loại khác và log ngoài 7 ngày', () => {
    const days = dailyConsumption(
      [
        log('Auto_Deduct', -100, at(0, 9)), log('Auto_Deduct', -50, at(0, 13)), log('Refund', 30, at(0, 14)),
        log('Auto_Deduct', -80, at(2)), log('Import', 500, at(2)), log('Waste', -20, at(2)), log('Auto_Deduct', -999, at(7)),
      ],
      now,
    );
    expect(days[6].value).toBe(120); // hôm nay: 100 + 50 − 30
    expect(days[4].value).toBe(80); // 2 ngày trước: chỉ tính Auto_Deduct
    expect(days.reduce((s, d) => s + d.value, 0)).toBe(200); // log 7 ngày trước không lọt vào
  });
  it('ngày hoàn nhiều hơn trừ thì chặn ở 0', () => {
    expect(dailyConsumption([log('Refund', 40, at(1))], now)[5].value).toBe(0);
  });
});

describe('makeAdjustSchema', () => {
  const schema = makeAdjustSchema(1000);
  const ok = { transactionType: 'Adjustment', quantityChanged: -10, reason: 'Kiểm lại' } as const;

  it('hợp lệ', () => {
    expect(schema.safeParse(ok).success).toBe(true);
  });
  it('lý do rỗng/khoảng trắng → lỗi ở reason', () => {
    const r = schema.safeParse({ ...ok, reason: '   ' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['reason']);
  });
  it('số lượng 0 hoặc NaN → lỗi', () => {
    expect(schema.safeParse({ ...ok, quantityChanged: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...ok, quantityChanged: Number.NaN }).success).toBe(false);
  });
  it('Waste phải âm', () => {
    expect(schema.safeParse({ ...ok, transactionType: 'Waste', quantityChanged: 5 }).success).toBe(false);
    expect(schema.safeParse({ ...ok, transactionType: 'Waste', quantityChanged: -5 }).success).toBe(true);
  });
  it('giảm vượt tồn → lỗi, giảm đúng bằng tồn → hợp lệ', () => {
    expect(schema.safeParse({ ...ok, quantityChanged: -1001 }).success).toBe(false);
    expect(schema.safeParse({ ...ok, quantityChanged: -1000 }).success).toBe(true);
  });
});

describe('formatLogReference', () => {
  it('đơn / phiếu nhập / không có', () => {
    expect(formatLogReference({ referenceType: 'Order', referenceId: '7' })).toBe('Đơn #7');
    expect(formatLogReference({ referenceType: 'PurchaseOrder', referenceId: 'PO-1' })).toBe('Phiếu nhập PO-1');
    expect(formatLogReference({ referenceType: null, referenceId: null })).toBeNull();
  });
});
