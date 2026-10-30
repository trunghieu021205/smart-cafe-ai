import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureHttp, isApiError, orderApi, paymentApi, storeApi } from '@/shared/api';
import type { ApiError } from '@/shared/api';
import type { OrderDetail, PayOrdersInput } from '@/shared/types';
import { db, resetDb } from '../db';
import { seedDemoOrders } from '../seed';
import { mockConfig, url } from '../utils';
import { handlers } from './index';
import { MOCK_PASSWORD, resetAuthMock } from './identity';

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  resetAuthMock();
  mockConfig.latencyMs = 0;
  mockConfig.enforceAuth = false;
});
afterEach(() => server.resetHandlers());

async function placeDineIn(): Promise<OrderDetail> {
  const session = await storeApi.openTableSession({ qrCode: 'QR-B1-T01' });
  return orderApi.createOrder({
    orderSource: 'QR', fulfillmentType: 'Dine_In', branchId: 1, tableSessionId: session.id,
    lines: [{ variantId: 12, quantity: 2, options: [{ optionId: 101 }, { optionId: 104 }] }],
  });
}
const cash = (order: OrderDetail, over: Partial<PayOrdersInput> = {}): PayOrdersInput => ({
  orderIds: [order.id], method: 'Cash', cashReceived: order.finalAmount + 5_000, ...over,
});
const expectApiError = async (p: Promise<unknown>, status: number, code: string) => {
  const err = (await p.then(() => null, (e: unknown) => e)) as ApiError | null;
  expect(isApiError(err)).toBe(true);
  expect([err?.status, err?.code]).toEqual([status, code]);
};
const dbOrder = (id: number) => db.orders.find((o) => o.id === id)!;

describe('POST /payment/payments — thu tiền mặt tại quầy', () => {
  it('đơn hợp lệ: tạo payment Success + allocation, tính tiền thừa, đơn chuyển Paid và tăng version', async () => {
    const order = await placeDineIn();
    const res = await paymentApi.payOrders(cash(order));

    expect(res.payment).toMatchObject({ paymentMethod: 'Cash', status: 'Success', amount: order.finalAmount, cashReceived: order.finalAmount + 5_000, changeAmount: 5_000 });
    expect(res.allocations).toEqual([expect.objectContaining({ paymentId: res.payment.id, orderId: order.id, allocatedAmount: order.finalAmount })]);
    expect(dbOrder(order.id)).toMatchObject({ paymentStatus: 'Paid', version: order.version + 1 });
    expect(dbOrder(order.id).status).toBe(order.status); // thanh toán độc lập với tiến trình pha chế
    // dữ liệu đọc lại qua API phản ánh trạng thái mới
    expect((await orderApi.getOrder(order.id)).paymentStatus).toBe('Paid');
    expect((await orderApi.listOrders({ cashier: 'feed' })).items.find((o) => o.id === order.id)?.paymentStatus).toBe('Paid');
  });

  it('số tiền lấy từ đơn trong db, không tin payload (cashReceived < tổng → từ chối, không ghi gì)', async () => {
    const order = await placeDineIn();
    await expectApiError(paymentApi.payOrders(cash(order, { cashReceived: order.finalAmount - 1 })), 400, 'INSUFFICIENT_CASH');
    await expectApiError(paymentApi.payOrders({ orderIds: [order.id], method: 'Cash' }), 400, 'VALIDATION_ERROR');
    expect(db.payments).toHaveLength(0);
    expect(dbOrder(order.id).paymentStatus).toBe('Unpaid');
  });

  it('đơn không tồn tại → 404 ORDER_NOT_FOUND; orderIds sai → 400', async () => {
    await expectApiError(paymentApi.payOrders({ orderIds: [9999], method: 'Cash', cashReceived: 1_000_000 }), 404, 'ORDER_NOT_FOUND');
    await expectApiError(paymentApi.payOrders({ orderIds: [], method: 'Cash', cashReceived: 1 }), 400, 'VALIDATION_ERROR');
    await expectApiError(paymentApi.payOrders({ orderIds: [1, 1], method: 'Cash', cashReceived: 1 }), 400, 'VALIDATION_ERROR');
  });

  it('phương thức không phù hợp quầy (COD) → 400 INVALID_PAYMENT_METHOD', async () => {
    // VNPay/Momo không còn bị từ chối ở đây: đã thành giao dịch cổng thanh toán giả (xem describe bên dưới).
    const order = await placeDineIn();
    await expectApiError(paymentApi.payOrders(cash(order, { method: 'COD' })), 400, 'INVALID_PAYMENT_METHOD');
    expect(db.payments).toHaveLength(0);
  });

  it('đơn không đủ điều kiện (đã hủy / chờ cổng thanh toán / Online chưa trả) → 409 ORDER_NOT_PAYABLE', async () => {
    seedDemoOrders();
    const byStatus = (status: string) => db.orders.find((o) => o.status === status && o.paymentStatus === 'Unpaid')!;
    for (const o of [byStatus('Rejected'), byStatus('Pending_Payment'), byStatus('Cancelled')]) {
      await expectApiError(paymentApi.payOrders({ orderIds: [o.id], method: 'Cash', cashReceived: o.finalAmount }), 409, 'ORDER_NOT_PAYABLE');
    }
    const onlineUnpaid = db.orders.find((o) => o.orderSource === 'Online' && o.paymentStatus === 'Unpaid' && o.status !== 'Pending_Payment' && o.status !== 'Cancelled');
    if (onlineUnpaid) await expectApiError(paymentApi.payOrders({ orderIds: [onlineUnpaid.id], method: 'Cash', cashReceived: onlineUnpaid.finalAmount }), 409, 'ORDER_NOT_PAYABLE');
    expect(db.payments.filter((p) => p.paymentMethod === 'Cash')).toHaveLength(0);
  });

  it('đơn đã thanh toán online → 409 ORDER_ALREADY_PAID, không tạo giao dịch tiền mặt', async () => {
    seedDemoOrders();
    const paidOnline = db.orders.filter((o) => o.orderSource === 'Online' && o.paymentStatus === 'Paid');
    expect(paidOnline.length).toBeGreaterThan(0);
    const before = db.payments.length;
    for (const o of paidOnline) {
      const err = (await paymentApi.payOrders({ orderIds: [o.id], method: 'Cash', cashReceived: o.finalAmount + 1 }).then(() => null, (e: unknown) => e)) as ApiError;
      expect([err.status, err.code]).toEqual([409, 'ORDER_ALREADY_PAID']);
      expect(err.message).toContain('online');
    }
    expect(db.payments).toHaveLength(before);
  });

  it('đơn đã thu tại quầy → 409 ORDER_ALREADY_PAID với key mới; số giao dịch vẫn 1', async () => {
    const order = await placeDineIn();
    await paymentApi.payOrders(cash(order, { idempotencyKey: 'k1' }));
    const err = (await paymentApi.payOrders(cash(order, { idempotencyKey: 'k2' })).then(() => null, (e: unknown) => e)) as ApiError;
    expect([err.status, err.code]).toEqual([409, 'ORDER_ALREADY_PAID']);
    expect(err.message).toContain('tại quầy');
    expect(db.payments).toHaveLength(1);
    expect(db.allocations).toHaveLength(1);
  });

  it('cùng idempotencyKey → trả lại đúng giao dịch cũ, không tạo thêm; key dùng cho đơn khác → 409', async () => {
    const order = await placeDineIn();
    const first = await paymentApi.payOrders(cash(order, { idempotencyKey: 'same' }));
    const replay = await paymentApi.payOrders(cash(order, { idempotencyKey: 'same' }));
    expect(replay.payment.id).toBe(first.payment.id);
    expect(replay.invoice?.id).toBe(first.invoice?.id);
    expect(db.payments).toHaveLength(1);
    await expectApiError(paymentApi.payOrders({ orderIds: [order.id + 100], method: 'Cash', cashReceived: 1, idempotencyKey: 'same' }), 409, 'IDEMPOTENCY_KEY_REUSED');
  });

  it('nhiều request đồng thời cho cùng một đơn → đúng 1 giao dịch thành công', async () => {
    mockConfig.latencyMs = 20;
    const order = await placeDineIn();
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => paymentApi.payOrders(cash(order, { idempotencyKey: `race-${n}` }))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) expect((r.reason as ApiError).code).toBe('ORDER_ALREADY_PAID');
    expect(db.payments).toHaveLength(1);
    expect(db.invoices).toHaveLength(1);
    expect(dbOrder(order.id).version).toBe(order.version + 1);
  });

  it('khách (Customer) không được thu tiền tại quầy', async () => {
    const order = await placeDineIn();
    const login = await fetch(url('/identity/auth/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'customer@smartcafe.vn', password: MOCK_PASSWORD }),
    });
    const { accessToken } = (await login.json()) as { accessToken: string };
    configureHttp({ getToken: () => accessToken });
    try {
      await expectApiError(paymentApi.payOrders(cash(order)), 403, 'FORBIDDEN');
    } finally {
      configureHttp({ getToken: () => null });
    }
    expect(db.payments).toHaveLength(0);
  });
});

describe('E-invoice mock', () => {
  it('thanh toán thành công phát hành đúng 1 hóa đơn liên kết đúng order + payment, số tiền khớp đơn', async () => {
    const order = await placeDineIn();
    const res = await paymentApi.payOrders(cash(order, { invoice: { buyerName: 'Nguyễn Văn A', email: 'a@example.com' } }));
    expect(res.invoice).toMatchObject({ status: 'Issued', buyerName: 'Nguyễn Văn A', totalAmount: order.finalAmount, vatAmount: order.vatAmount });
    expect(res.invoice!.subtotalAmount + res.invoice!.vatAmount).toBe(res.invoice!.totalAmount);

    const inv = await paymentApi.getInvoiceByOrder(order.id);
    expect(inv.id).toBe(res.invoice!.id);
    expect(inv).toMatchObject({
      paymentId: res.payment.id, paymentMethod: 'Cash', paymentStatus: 'Success', orders: [{ id: order.id, orderCode: order.orderCode }],
      grossAmount: order.subTotal, discountAmount: 0, totalAmount: order.finalAmount,
    });
    expect(inv.invoiceNumber).toMatch(/^SC-\d{4}-\d{5}$/);
    expect(inv.items.map((i) => [i.quantity, i.amount])).toEqual(order.items.map((i) => [i.quantity, i.lineTotal]));
  });

  it('không ghi thông tin người mua → hóa đơn bán lẻ "Khách lẻ", không bịa tên/email/MST', async () => {
    const order = await placeDineIn();
    await paymentApi.payOrders(cash(order));
    const inv = await paymentApi.getInvoiceByOrder(order.id);
    expect(inv).toMatchObject({ buyerName: 'Khách lẻ', email: null, buyerTaxCode: null, buyerAddress: null });
  });

  it('mở/đọc hóa đơn nhiều lần không tạo hóa đơn hay payment mới', async () => {
    const order = await placeDineIn();
    await paymentApi.payOrders(cash(order));
    const ids = await Promise.all([1, 2, 3].map(async () => (await paymentApi.getInvoiceByOrder(order.id)).id));
    expect(new Set(ids).size).toBe(1);
    expect(db.invoices).toHaveLength(1);
    expect(db.payments).toHaveLength(1);
  });

  it('payment chưa thành công → không có hóa đơn: đơn chưa trả → 409; payment Failed → 409; đơn lạ → 404', async () => {
    const order = await placeDineIn();
    await expectApiError(paymentApi.getInvoiceByOrder(order.id), 409, 'PAYMENT_NOT_COMPLETED');
    // giao dịch cổng thanh toán thất bại gắn vào đơn: không được coi là đã trả
    db.payments.push({ id: 900, branchId: 1, paymentMethod: 'VNPay', amount: order.finalAmount, refundedAmount: 0, status: 'Failed', createdAt: 'x', updatedAt: 'x' });
    db.allocations.push({ id: 900, paymentId: 900, orderId: order.id, allocatedAmount: order.finalAmount, createdAt: 'x' });
    await expectApiError(paymentApi.getInvoiceByOrder(order.id), 409, 'PAYMENT_NOT_COMPLETED');
    await expectApiError(paymentApi.getInvoiceByOrder(99999), 404, 'ORDER_NOT_FOUND');
    await expectApiError(paymentApi.getInvoiceByOrder(0), 400, 'VALIDATION_ERROR');
    expect(db.invoices).toHaveLength(0);
  });

  it('thông tin người mua sai → 400 và không ghi gì', async () => {
    const order = await placeDineIn();
    await expectApiError(paymentApi.payOrders(cash(order, { invoice: { buyerName: '  ' } })), 400, 'VALIDATION_ERROR');
    await expectApiError(paymentApi.payOrders(cash(order, { invoice: { buyerName: 'A', email: 'không-phải-email' } })), 400, 'VALIDATION_ERROR');
    expect(db.payments).toHaveLength(0);
    expect(dbOrder(order.id).paymentStatus).toBe('Unpaid');
  });

  it('đơn seed đã trả online có payment VNPay + hóa đơn thật, khớp paymentStatus', async () => {
    seedDemoOrders();
    const paid = db.orders.filter((o) => o.paymentStatus === 'Paid');
    expect(paid.length).toBeGreaterThan(0);
    for (const o of paid) {
      const inv = await paymentApi.getInvoiceByOrder(o.id);
      expect(inv).toMatchObject({ paymentMethod: 'VNPay', totalAmount: o.finalAmount });
    }
    expect(db.payments).toHaveLength(paid.length);
    expect(db.orders.filter((o) => o.paymentStatus === 'Unpaid').every((o) => !db.allocations.some((a) => a.orderId === o.id))).toBe(true);
  });
});

describe('GET /api/cashier/pending (view cũ)', () => {
  it('suy ra từ db: đơn vừa thu tiền biến mất khỏi PAY_AT_COUNTER', async () => {
    const order = await placeDineIn();
    const load = async () => (await (await fetch(url('/cashier/pending'))).json()) as { orderId: number; status: string }[];
    expect((await load()).find((r) => r.orderId === order.id)?.status).toBe('PAY_AT_COUNTER');
    await paymentApi.payOrders(cash(order));
    expect((await load()).find((r) => r.orderId === order.id)).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// Cổng thanh toán giả lập (VNPay/Momo) cho đơn Dine-in
// ══════════════════════════════════════════════════════════════════════
async function placeDineInWithSession(userId?: string): Promise<{ order: OrderDetail; sessionCode: string }> {
  const session = await storeApi.openTableSession({ qrCode: 'QR-B1-T01' });
  const order = await orderApi.createOrder({
    orderSource: 'QR', fulfillmentType: 'Dine_In', branchId: 1, tableSessionId: session.id,
    lines: [{ variantId: 12, quantity: 2, options: [{ optionId: 101 }, { optionId: 104 }] }],
    ...(userId ? { userId } : {}),
  });
  return { order, sessionCode: session.sessionCode };
}
const vnpay = (order: OrderDetail, over: Partial<PayOrdersInput> = {}): PayOrdersInput => ({ orderIds: [order.id], method: 'VNPay', ...over });
const asCustomer = async (email: string, run: () => Promise<void>) => {
  const login = await fetch(url('/identity/auth/login'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: email, password: MOCK_PASSWORD }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  configureHttp({ getToken: () => accessToken });
  try {
    await run();
  } finally {
    configureHttp({ getToken: () => null });
  }
};

describe('Cổng thanh toán giả lập — tạo giao dịch', () => {
  it('guest có đúng session code tạo được payment VNPay: 201, Pending, hết hạn sau 15 phút, redirectUrl nội bộ, đơn vẫn Unpaid', async () => {
    const { order, sessionCode } = await placeDineInWithSession();
    const res = await paymentApi.payOrders(vnpay(order), { sessionCode });

    expect(res.payment).toMatchObject({ paymentMethod: 'VNPay', status: 'Pending', amount: order.finalAmount, paidAt: null, transactionId: null });
    const ttl = Date.parse(res.payment.expiresAt!) - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000);
    expect(res.redirectUrl).toBe(`/payment/${order.id}?paymentId=${res.payment.id}`);
    expect(res.invoice).toBeNull();
    expect(dbOrder(order.id).paymentStatus).toBe('Unpaid'); // chỉ IPN mới được chốt tiền
    expect(db.invoices).toHaveLength(0);

  });

  it('guest thiếu hoặc sai session code → 403, không tạo gì', async () => {
    const { order } = await placeDineInWithSession();
    await expectApiError(paymentApi.payOrders(vnpay(order)), 403, 'FORBIDDEN');
    await expectApiError(paymentApi.payOrders(vnpay(order), { sessionCode: 'sai-session' }), 403, 'FORBIDDEN');
    expect(db.payments).toHaveLength(0);
  });

  it('guest với đơn Online → 403 dù gửi session code của một bàn khác', async () => {
    seedDemoOrders();
    const online = db.orders.find((o) => o.orderSource === 'Online' && o.paymentStatus === 'Unpaid' && o.status === 'Pending_Payment')!;
    const { sessionCode } = await placeDineInWithSession();
    const before = db.payments.length; // seed đã có sẵn payment cho các đơn Online đã trả
    await expectApiError(paymentApi.payOrders(vnpay(online), { sessionCode }), 403, 'FORBIDDEN');
    await expectApiError(paymentApi.payOrders(vnpay(online)), 403, 'FORBIDDEN');
    expect(db.payments).toHaveLength(before);
  });

  it('session code của bàn khác không dùng được cho đơn này', async () => {
    const { order } = await placeDineInWithSession();
    const other = await storeApi.openTableSession({ qrCode: 'QR-B1-T02' });
    await expectApiError(paymentApi.payOrders(vnpay(order), { sessionCode: other.sessionCode }), 403, 'FORBIDDEN');
  });

  it('Customer đăng nhập chỉ trả được đơn của chính mình (đơn người khác → 404)', async () => {
    const { order } = await placeDineInWithSession('u-customer');
    await asCustomer('customer2@smartcafe.vn', async () => {
      await expectApiError(paymentApi.payOrders(vnpay(order)), 404, 'ORDER_NOT_FOUND');
    });
    expect(db.payments).toHaveLength(0);
    await asCustomer('customer@smartcafe.vn', async () => {
      const res = await paymentApi.payOrders(vnpay(order));
      expect(res.payment.status).toBe('Pending');
    });
  });

  it('đơn đã Paid → 409 ORDER_ALREADY_PAID; đơn không tồn tại → 404', async () => {
    const { order, sessionCode } = await placeDineInWithSession();
    await paymentApi.payOrders(cash(order));
    await expectApiError(paymentApi.payOrders(vnpay(order, { idempotencyKey: 'moi' }), { sessionCode }), 409, 'ORDER_ALREADY_PAID');
    await expectApiError(paymentApi.payOrders({ orderIds: [9999], method: 'VNPay' }, { sessionCode }), 404, 'ORDER_NOT_FOUND');
    expect(db.payments.filter((p) => p.paymentMethod === 'VNPay')).toHaveLength(0);
  });

  it('idempotent: cùng key hoặc bấm lặp khi giao dịch còn hiệu lực → cùng một payment, không tạo thêm', async () => {
    const { order, sessionCode } = await placeDineInWithSession();
    const first = await paymentApi.payOrders(vnpay(order, { idempotencyKey: 'k-1' }), { sessionCode });
    const replay = await paymentApi.payOrders(vnpay(order, { idempotencyKey: 'k-1' }), { sessionCode });
    const again = await paymentApi.payOrders(vnpay(order, { idempotencyKey: 'k-2' }), { sessionCode });
    expect([replay.payment.id, again.payment.id]).toEqual([first.payment.id, first.payment.id]);
    expect(db.payments).toHaveLength(1);
    await expectApiError(paymentApi.payOrders({ orderIds: [order.id + 100], method: 'VNPay', idempotencyKey: 'k-1' }, { sessionCode }), 404, 'ORDER_NOT_FOUND');
  });
});

describe('Cổng thanh toán giả lập — IPN giả (simulate) và polling', () => {
  async function pending() {
    const { order, sessionCode } = await placeDineInWithSession();
    const res = await paymentApi.payOrders(vnpay(order), { sessionCode });
    return { order, sessionCode, id: res.payment.id };
  }

  it('simulate success → payment Success, đơn Paid + paidOnline, có hóa đơn; polling thấy Success', async () => {
    const { order, sessionCode, id } = await pending();
    const res = await paymentApi.simulatePayment(id, { result: 'success' }, { sessionCode });

    expect(res.payment).toMatchObject({ status: 'Success', transactionId: expect.stringMatching(/^MOCK-VNPAY-/) as unknown as string });
    expect(res.payment.paidAt).toBeTruthy();
    expect(res.invoice).toMatchObject({ status: 'Issued', totalAmount: order.finalAmount });
    expect(dbOrder(order.id)).toMatchObject({ paymentStatus: 'Paid', paidOnline: true, version: order.version + 1 });
    expect((await paymentApi.getInvoiceByOrder(order.id)).paymentMethod).toBe('VNPay');
    expect((await paymentApi.getPayment(id, { sessionCode })).payment.status).toBe('Success');
    // staff feed: đơn rời "chờ thu tại quầy", sang "đã trả online"
    const pendingView = (await (await fetch(url('/cashier/pending'))).json()) as { orderId: number; status: string }[];
    expect(pendingView.find((r) => r.orderId === order.id)?.status).toBe('PAID_ONLINE');
    // đã trả online → thu tiền mặt bị từ chối
    await expectApiError(paymentApi.payOrders(cash(order, { idempotencyKey: 'sau' })), 409, 'ORDER_ALREADY_PAID');
  });

  it('simulate failed → payment Failed, đơn vẫn Unpaid, không hóa đơn; thử lại tạo giao dịch mới; sau đó vẫn thu tiền mặt được', async () => {
    const { order, sessionCode, id } = await pending();
    const res = await paymentApi.simulatePayment(id, { result: 'failed' }, { sessionCode });
    expect(res.payment.status).toBe('Failed');
    expect(res.redirectUrl).toBeNull();
    expect(dbOrder(order.id)).toMatchObject({ paymentStatus: 'Unpaid', version: order.version });
    expect(db.invoices).toHaveLength(0);

    const retry = await paymentApi.payOrders(vnpay(order, { idempotencyKey: 'retry' }), { sessionCode });
    expect(retry.payment.id).not.toBe(id);
    expect(retry.payment.status).toBe('Pending');

    const counter = await paymentApi.payOrders(cash(order, { idempotencyKey: 'quay' }));
    expect(counter.payment.status).toBe('Success');
    expect(dbOrder(order.id).paidOnline).toBeUndefined();
    // giao dịch online còn treo bị hủy, IPN thành công đến muộn không được ghi thêm tiền
    expect((await paymentApi.getPayment(retry.payment.id, { sessionCode })).payment.status).toBe('Cancelled');
    await expectApiError(paymentApi.simulatePayment(retry.payment.id, { result: 'success' }, { sessionCode }), 409, 'PAYMENT_ALREADY_SETTLED');
    expect(db.invoices).toHaveLength(1);
  });

  it('simulate lặp lại: cùng kết quả → 200 idempotent (không thêm hóa đơn); khác kết quả → 409', async () => {
    const { order, sessionCode, id } = await pending();
    const first = await paymentApi.simulatePayment(id, { result: 'success' }, { sessionCode });
    const again = await paymentApi.simulatePayment(id, { result: 'success' }, { sessionCode });
    expect(again.payment).toEqual(first.payment);
    expect(again.invoice?.id).toBe(first.invoice?.id);
    expect(db.invoices).toHaveLength(1);
    expect(dbOrder(order.id).version).toBe(order.version + 1);

    await expectApiError(paymentApi.simulatePayment(id, { result: 'failed' }, { sessionCode }), 409, 'PAYMENT_ALREADY_SETTLED');
    expect(dbOrder(order.id).paymentStatus).toBe('Paid');
    await expectApiError(paymentApi.simulatePayment(id, { result: 'xyz' as 'success' }, { sessionCode }), 400, 'VALIDATION_ERROR');
  });

  it('quá hạn 15 phút: GET trả Expired, IPN success đến muộn bị từ chối, đơn vẫn Unpaid', async () => {
    const { order, sessionCode, id } = await pending();
    db.payments.find((p) => p.id === id)!.expiresAt = '2000-01-01T00:00:00';
    expect((await paymentApi.getPayment(id, { sessionCode })).payment.status).toBe('Expired');
    await expectApiError(paymentApi.simulatePayment(id, { result: 'success' }, { sessionCode }), 409, 'PAYMENT_ALREADY_SETTLED');
    expect(dbOrder(order.id).paymentStatus).toBe('Unpaid');
    // simulate 'expired' cũng chốt được giao dịch đang Pending
    const second = await paymentApi.payOrders(vnpay(order, { idempotencyKey: 'again' }), { sessionCode });
    expect((await paymentApi.simulatePayment(second.payment.id, { result: 'expired' }, { sessionCode })).payment.status).toBe('Expired');
  });

  it('GET/simulate cũng kiểm quyền: guest sai session → 403, giao dịch không tồn tại → 404', async () => {
    const { id } = await pending();
    await expectApiError(paymentApi.getPayment(id), 403, 'FORBIDDEN');
    await expectApiError(paymentApi.simulatePayment(id, { result: 'success' }, { sessionCode: 'sai' }), 403, 'FORBIDDEN');
    await expectApiError(paymentApi.getPayment(9999), 404, 'PAYMENT_NOT_FOUND');
    expect(db.invoices).toHaveLength(0);
  });
});

describe('Nhánh Cash không đổi hành vi', () => {
  it('Cash vẫn tạo ngay payment Success + hóa đơn (redirectUrl null), đơn không bị đánh dấu paidOnline', async () => {
    const { order } = await placeDineInWithSession();
    const res = await paymentApi.payOrders(cash(order));
    expect(res).toMatchObject({ redirectUrl: null, payment: { paymentMethod: 'Cash', status: 'Success' } });
    expect(res.invoice).toBeTruthy();
    expect(dbOrder(order.id)).toMatchObject({ paymentStatus: 'Paid' });
    expect(dbOrder(order.id).paidOnline).toBeUndefined();
  });
});
