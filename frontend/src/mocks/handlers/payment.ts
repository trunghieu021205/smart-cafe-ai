import { http, HttpResponse } from 'msw';
import type { InvoiceRequestInput, OrderDetail, PayOrdersInput, SimulatedPaymentResult } from '@/shared/types';
import { db, nowNaive } from '../db';
import {
  assertCounterPayable, assertGatewayPayable, buildInvoiceDetail, createGatewayPayment, isGatewayMethod, livePendingPaymentOf,
  markOrdersPaid, ordersOfPayment, reconcilePayment, recordPayment, resultOfPayment, settleGatewayPayment, successfulPaymentOf,
} from '../payment-service';
import { fail, guarded, readJson, requireAuth, url } from '../utils';
import { accountFromRequest } from './identity';

const EMAIL = /^\S+@\S+\.\S+$/;

function validateInvoiceInput(inv: InvoiceRequestInput | undefined): void {
  if (inv === undefined) return;
  if (typeof inv.buyerName !== 'string' || !inv.buyerName.trim()) fail(400, 'VALIDATION_ERROR', 'Hóa đơn cần tên người mua (buyerName)');
  if (inv.email && !EMAIL.test(inv.email.trim())) fail(400, 'VALIDATION_ERROR', 'Email nhận hóa đơn không hợp lệ');
}

/** Header khách guest gửi để chứng minh đang ngồi ở bàn của đơn (xem shared/api/payment.ts). */
const SESSION_HEADER = 'X-Table-Session-Code';
const SIMULATED_RESULTS: SimulatedPaymentResult[] = ['success', 'failed', 'expired'];

/**
 * Quyền truy cập một đơn qua cổng thanh toán:
 * - Staff/Manager/Admin: như trước (không giới hạn thêm).
 * - Customer đăng nhập: chỉ đơn của chính mình; đơn người khác trả 404 như không tồn tại (giống GET /orders).
 * - Guest (không token hợp lệ): CHỈ đơn Dine_In và header X-Table-Session-Code khớp phiên bàn của đơn → còn lại 403.
 */
function assertGatewayAccess(request: Request, order: OrderDetail): void {
  const caller = accountFromRequest(request);
  if (caller) {
    if (caller.roleName === 'Customer' && order.userId !== caller.id) fail(404, 'ORDER_NOT_FOUND', `Không tìm thấy đơn ${order.id}`);
    return;
  }
  if (order.fulfillmentType !== 'Dine_In' || order.orderSource === 'Online') {
    fail(403, 'FORBIDDEN', 'Khách chưa đăng nhập chỉ được thanh toán đơn tại bàn của mình');
  }
  const code = request.headers.get(SESSION_HEADER);
  const session = db.sessions.find((s) => s.id === order.tableSessionId);
  if (!code || !session || session.sessionCode !== code) {
    fail(403, 'FORBIDDEN', 'Phiên bàn không khớp với đơn này');
  }
}

/** Đọc giao dịch + kiểm quyền trên MỌI đơn của nó; đưa Pending về trạng thái đúng (hết hạn / đơn đã trả nơi khác). */
function loadPaymentFor(request: Request, rawId: unknown) {
  const id = Number(rawId);
  const payment = Number.isInteger(id) ? db.payments.find((p) => p.id === id) : undefined;
  if (!payment) fail(404, 'PAYMENT_NOT_FOUND', `Không tìm thấy giao dịch ${String(rawId)}`);
  for (const o of ordersOfPayment(payment)) assertGatewayAccess(request, o);
  reconcilePayment(payment);
  return payment;
}

/** POST /payment/payments với method VNPay/Momo: tạo giao dịch Pending. Số tiền LUÔN tính từ đơn trong db. */
function createGatewayPaymentFromRequest(request: Request, input: Partial<PayOrdersInput>): Response {
  const caller = accountFromRequest(request);
  const ids = input.orderIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((n) => Number.isInteger(n) && n > 0)) {
    fail(400, 'VALIDATION_ERROR', 'orderIds phải là danh sách id đơn hợp lệ, không rỗng');
  }
  if (new Set(ids).size !== ids.length) fail(400, 'VALIDATION_ERROR', 'orderIds bị trùng');
  const method = input.method!;

  const orders: OrderDetail[] = ids.map((id) => db.orders.find((o) => o.id === id) ?? fail(404, 'ORDER_NOT_FOUND', `Không tìm thấy đơn ${id}`));
  orders.forEach((o) => assertGatewayAccess(request, o));
  validateInvoiceInput(input.invoice);

  // Idempotency: cùng key → trả lại đúng giao dịch cũ (200), kể cả khi giao dịch đã chốt.
  if (input.idempotencyKey) {
    const prior = db.payments.find((p) => p.idempotencyKey === input.idempotencyKey);
    if (prior) {
      const same = db.allocations.filter((a) => a.paymentId === prior.id).map((a) => a.orderId).sort().join() === [...ids].sort().join();
      if (!same) fail(409, 'IDEMPOTENCY_KEY_REUSED', 'idempotencyKey này đã dùng cho giao dịch của đơn khác');
      return HttpResponse.json(resultOfPayment(reconcilePayment(prior)), { status: 200 });
    }
  }

  // Đã có giao dịch cùng phương thức còn hiệu lực cho đơn (bấm lặp / request gửi lại với key mới) → dùng lại, không tạo thêm.
  if (orders.length === 1) {
    const live = livePendingPaymentOf(orders[0]!.id, method);
    if (live) return HttpResponse.json(resultOfPayment(live), { status: 200 });
  }

  orders.forEach(assertGatewayPayable);
  const result = createGatewayPayment({
    orders, method, createdBy: caller?.id ?? null, idempotencyKey: input.idempotencyKey ?? null, invoice: input.invoice,
  });
  return HttpResponse.json(result, { status: 201 });
}

export const paymentHandlers = [
  // POST /payment/payments — Cash: thu tiền tại quầy cho 1..N đơn (nhân viên). VNPay/Momo: tạo giao dịch cổng thanh toán giả.
  // Số tiền LUÔN tính từ đơn trong db.
  http.post(
    url('/payment/payments'),
    guarded(async ({ request }) => {
      // Nhánh cổng thanh toán cho phép khách guest nên không đòi token; mọi phương thức khác đi đúng đường cũ.
      const peek = (await request.clone().json().catch(() => null)) as Partial<PayOrdersInput> | null;
      if (peek && isGatewayMethod(peek.method)) {
        return createGatewayPaymentFromRequest(request, peek);
      }

      requireAuth(request);
      const caller = accountFromRequest(request);
      if (caller?.roleName === 'Customer') fail(403, 'FORBIDDEN', 'Chỉ nhân viên mới được thu tiền tại quầy');

      const input = await readJson<Partial<PayOrdersInput>>(request);
      // ── từ đây tới lúc ghi db KHÔNG có await: check-then-write là nguyên tử ──
      const ids = input.orderIds;
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((n) => Number.isInteger(n) && n > 0)) {
        fail(400, 'VALIDATION_ERROR', 'orderIds phải là danh sách id đơn hợp lệ, không rỗng');
      }
      if (new Set(ids).size !== ids.length) fail(400, 'VALIDATION_ERROR', 'orderIds bị trùng');
      if (!input.method) fail(400, 'VALIDATION_ERROR', 'Thiếu phương thức thanh toán (method)');

      // Idempotency: cùng key → trả lại đúng giao dịch cũ (200), không tạo giao dịch mới.
      if (input.idempotencyKey) {
        const prior = db.payments.find((p) => p.idempotencyKey === input.idempotencyKey);
        if (prior) {
          const same = db.allocations.filter((a) => a.paymentId === prior.id).map((a) => a.orderId).sort().join() === [...ids].sort().join();
          if (!same) fail(409, 'IDEMPOTENCY_KEY_REUSED', 'idempotencyKey này đã dùng cho giao dịch của đơn khác');
          return HttpResponse.json(resultOfPayment(prior), { status: 200 });
        }
      }

      if (input.method !== 'Cash') {
        fail(400, 'INVALID_PAYMENT_METHOD', `Thu tiền tại quầy chỉ hỗ trợ tiền mặt (Cash), không hỗ trợ ${input.method}`);
      }

      const orders: OrderDetail[] = ids.map((id) => db.orders.find((o) => o.id === id) ?? fail(404, 'ORDER_NOT_FOUND', `Không tìm thấy đơn ${id}`));
      orders.forEach(assertCounterPayable);

      const amount = orders.reduce((s, o) => s + o.finalAmount, 0);
      const cash = input.cashReceived;
      if (typeof cash !== 'number' || !Number.isFinite(cash)) fail(400, 'VALIDATION_ERROR', 'Thanh toán tiền mặt cần cashReceived');
      if (cash < amount) fail(400, 'INSUFFICIENT_CASH', `Khách đưa chưa đủ: cần ${amount}, nhận ${cash}`);
      validateInvoiceInput(input.invoice);

      const at = nowNaive();
      const result = recordPayment({
        orders, method: 'Cash', cashReceived: cash, createdBy: caller?.id ?? null,
        idempotencyKey: input.idempotencyKey ?? null, invoice: input.invoice, at,
      });
      markOrdersPaid(orders, at);
      return HttpResponse.json(result, { status: 201 });
    }),
  ),

  // GET /payment/payments/:id — trạng thái giao dịch (trang cổng thanh toán polling). Hết hạn được tính lúc đọc.
  http.get(
    url('/payment/payments/:id'),
    guarded(({ request, params }) => HttpResponse.json(resultOfPayment(loadPaymentFor(request, params.id)))),
  ),

  // POST /payment/payments/:id/simulate { result } — MOCK: đóng vai IPN của cổng. IPN là nguồn sự thật, trang chỉ polling.
  // Giao dịch đã chốt: gọi lại cùng kết quả → 200 (replay, không tác dụng phụ); khác kết quả → 409 PAYMENT_ALREADY_SETTLED.
  http.post(
    url('/payment/payments/:id/simulate'),
    guarded(async ({ request, params }) => {
      const input = await readJson<{ result?: SimulatedPaymentResult }>(request);
      const result = input.result;
      if (!result || !SIMULATED_RESULTS.includes(result)) fail(400, 'VALIDATION_ERROR', 'result phải là success | failed | expired');
      const payment = loadPaymentFor(request, params.id);

      if (payment.status === 'Pending') return HttpResponse.json(settleGatewayPayment(payment, result));

      const settledAs: Record<string, SimulatedPaymentResult | undefined> = { Success: 'success', Failed: 'failed', Expired: 'expired' };
      if (settledAs[payment.status] === result) return HttpResponse.json(resultOfPayment(payment));
      fail(409, 'PAYMENT_ALREADY_SETTLED', `Giao dịch #${payment.id} đã chốt ở trạng thái ${payment.status}`);
    }),
  ),

  // GET /payment/invoices?orderId= — chỉ đọc. Không bao giờ phát hành hóa đơn mới.
  http.get(
    url('/payment/invoices'),
    guarded(({ request }) => {
      requireAuth(request);
      const caller = accountFromRequest(request);
      const raw = new URL(request.url).searchParams.get('orderId');
      const orderId = Number(raw);
      if (raw === null || !Number.isInteger(orderId) || orderId < 1) fail(400, 'VALIDATION_ERROR', 'orderId không hợp lệ');

      const order = db.orders.find((o) => o.id === orderId);
      if (!order || (caller?.roleName === 'Customer' && order.userId !== caller.id)) fail(404, 'ORDER_NOT_FOUND', `Không tìm thấy đơn ${orderId}`);

      const payment = successfulPaymentOf(orderId);
      if (!payment) fail(409, 'PAYMENT_NOT_COMPLETED', `Đơn ${order.orderCode} chưa có giao dịch thanh toán thành công nên chưa có hóa đơn`);
      const record = db.invoices.find((r) => r.paymentId === payment.id);
      if (!record) fail(404, 'INVOICE_NOT_FOUND', `Giao dịch #${payment.id} chưa có hóa đơn`);
      return HttpResponse.json(buildInvoiceDetail(record));
    }),
  ),
];
