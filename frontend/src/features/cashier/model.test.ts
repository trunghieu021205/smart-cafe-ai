import { describe, expect, it } from 'vitest';
import { canCollectAtCounter, cashierGroup, changeDue, matchesSearch } from './model';

type O = Parameters<typeof cashierGroup>[0];
const o = (over: Partial<O>): O => ({ orderSource: 'QR', paymentStatus: 'Unpaid', status: 'Pending', ...over });

describe('cashierGroup', () => {
  it('đơn tại quầy (QR/POS) chưa thanh toán → chờ thu', () => {
    expect(cashierGroup(o({ orderSource: 'QR' }))).toBe('awaiting_counter');
    expect(cashierGroup(o({ orderSource: 'POS', status: 'Served' }))).toBe('awaiting_counter');
  });

  it('đơn Online đã Paid → đã trả online; Online chưa Paid thì không thuộc nhóm nào (không suy diễn)', () => {
    expect(cashierGroup(o({ orderSource: 'Online', paymentStatus: 'Paid', status: 'Ready' }))).toBe('paid_online');
    expect(cashierGroup(o({ orderSource: 'Online', paymentStatus: 'Unpaid', status: 'Ready' }))).toBeNull();
    expect(cashierGroup(o({ orderSource: 'Online', paymentStatus: 'Unpaid', status: 'Pending_Payment' }))).toBeNull();
  });

  it('đơn Dine-in (QR) đã trả qua cổng online → đã trả online; trả tiền mặt thì không thuộc nhóm nào', () => {
    expect(cashierGroup(o({ orderSource: 'QR', paymentStatus: 'Paid', paidOnline: true }))).toBe('paid_online');
    expect(cashierGroup(o({ orderSource: 'QR', paymentStatus: 'Paid' }))).toBeNull();
    expect(cashierGroup(o({ orderSource: 'QR', paymentStatus: 'Unpaid', paidOnline: true }))).toBe('awaiting_counter');
    expect(canCollectAtCounter(o({ paymentStatus: 'Paid', paidOnline: true }))).toBe(false);
  });

  it('đơn đã kết thúc hoặc đã thanh toán tại quầy không còn trong danh sách thu', () => {
    for (const status of ['Completed', 'Cancelled', 'Rejected'] as const) expect(cashierGroup(o({ status }))).toBeNull();
    expect(cashierGroup(o({ paymentStatus: 'Paid' }))).toBeNull();
  });
});

describe('canCollectAtCounter', () => {
  it('chỉ đơn chờ thu mới thu được; không bao giờ thu lại đơn đã thanh toán/trả online', () => {
    expect(canCollectAtCounter(o({}))).toBe(true);
    expect(canCollectAtCounter(o({ paymentStatus: 'Paid' }))).toBe(false);
    expect(canCollectAtCounter(o({ orderSource: 'Online', paymentStatus: 'Paid' }))).toBe(false);
    expect(canCollectAtCounter(o({ paymentStatus: 'Refunded' }))).toBe(false);
  });
});

describe('matchesSearch', () => {
  const order = { orderCode: 'SC00904', tableNumber: '04' };
  it('không phân biệt hoa thường, bỏ khoảng trắng đầu/cuối và dấu #', () => {
    expect(matchesSearch(order, '  sc00904 ')).toBe(true);
    expect(matchesSearch(order, '#SC009')).toBe(true);
    expect(matchesSearch(order, '904')).toBe(true);
  });
  it('khớp số bàn; rỗng thì khớp tất cả; sai thì không khớp', () => {
    expect(matchesSearch(order, '04')).toBe(true);
    expect(matchesSearch(order, '   ')).toBe(true);
    expect(matchesSearch(order, 'SC999')).toBe(false);
    expect(matchesSearch({ orderCode: 'SC1', tableNumber: null }, 'ban')).toBe(false);
  });
});

describe('changeDue', () => {
  it('tính tiền thừa; null khi chưa nhập hoặc thiếu tiền', () => {
    expect(changeDue(123_000, 200_000)).toBe(77_000);
    expect(changeDue(123_000, 123_000)).toBe(0);
    expect(changeDue(123_000, 100_000)).toBeNull();
    expect(changeDue(123_000, null)).toBeNull();
  });
});
