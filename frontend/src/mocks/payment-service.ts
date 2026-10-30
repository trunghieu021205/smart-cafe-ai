import { isTerminalOrderStatus } from '@/shared/lib';
import type {
  Invoice, InvoiceDetail, InvoiceItem, InvoiceRequestInput, OrderDetail, Payment, PaymentMethod, PayResult,
} from '@/shared/types';
import { db, isExpired, nowNaive, type MockInvoiceRecord } from './db';
import { fail } from './utils';

/**
 * Nghiệp vụ thanh toán + hóa đơn của mock, tách khỏi handler để seed và handler dùng chung.
 * Mọi hàm ở đây ĐỒNG BỘ: kiểm tra → ghi db không có `await` xen giữa, nên hai request đến cùng lúc
 * luôn được xử lý lần lượt (request thứ hai thấy đơn đã Paid).
 */

const VAT_RATE = 8;
const PAID_STATUSES = new Set(['Paid', 'Partially_Refunded', 'Refunded']);
export const GATEWAY_METHODS: PaymentMethod[] = ['VNPay', 'Momo'];
export const isGatewayMethod = (m: unknown): m is 'VNPay' | 'Momo' => m === 'VNPay' || m === 'Momo';
/** Giao dịch cổng thanh toán hết hạn sau 15 phút (cùng TTL với đơn Pending_Payment). */
export const GATEWAY_PAYMENT_TTL_MS = 15 * 60 * 1000;
const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** Giao dịch thành công của đơn (nếu có). Đơn có thể từng có giao dịch Failed/Expired — những cái đó không tính. */
export function successfulPaymentOf(orderId: number): Payment | undefined {
  for (const a of db.allocations) {
    if (a.orderId !== orderId) continue;
    const p = db.payments.find((x) => x.id === a.paymentId);
    if (p?.status === 'Success') return p;
  }
  return undefined;
}

/** Đơn tại quầy (QR/POS), còn mở, chưa thanh toán → nhân viên được thu tiền mặt. */
export const isCounterPayable = (o: OrderDetail): boolean =>
  o.orderSource !== 'Online' && o.paymentStatus === 'Unpaid' && !isTerminalOrderStatus(o.status) && o.status !== 'Pending_Payment';

/** Đơn đã được cổng thanh toán ghi nhận (Online, hoặc Dine-in trả online qua cổng): chỉ xem/in bill, không thu lại. */
export const isPaidOnline = (o: OrderDetail): boolean =>
  (o.orderSource === 'Online' || o.paidOnline === true) && o.paymentStatus === 'Paid' && !isTerminalOrderStatus(o.status);

/** Ném đúng lỗi nghiệp vụ nếu đơn không thể thu tiền tại quầy. */
export function assertCounterPayable(o: OrderDetail): void {
  if (PAID_STATUSES.has(o.paymentStatus)) {
    const prior = successfulPaymentOf(o.id);
    const online = prior ? GATEWAY_METHODS.includes(prior.paymentMethod) : o.orderSource === 'Online';
    fail(409, 'ORDER_ALREADY_PAID', online
      ? `Đơn ${o.orderCode} đã thanh toán online, không thu thêm tại quầy`
      : `Đơn ${o.orderCode} đã được thu tiền tại quầy`);
  }
  if (o.orderSource === 'Online') fail(409, 'ORDER_NOT_PAYABLE', `Đơn Online ${o.orderCode} không thu tiền tại quầy`);
  if (o.status === 'Pending_Payment' || isTerminalOrderStatus(o.status)) {
    fail(409, 'ORDER_NOT_PAYABLE', `Đơn ${o.orderCode} đang ở trạng thái ${o.status}, không thể thanh toán`);
  }
}

function describeItem(i: OrderDetail['items'][number]): string {
  const extras = [i.variantName !== 'Standard' ? `Size ${i.variantName}` : null, ...i.options.map((o) => o.optionName)].filter(Boolean);
  return extras.length ? `${i.productName} (${extras.join(', ')})` : i.productName;
}

/** Phát hành hóa đơn cho một payment THÀNH CÔNG. Đã có hóa đơn của payment này → trả lại cái cũ, không tạo thêm. */
export function issueInvoice(payment: Payment, orders: OrderDetail[], buyer: InvoiceRequestInput | undefined, at: string): MockInvoiceRecord {
  if (payment.status !== 'Success') fail(409, 'PAYMENT_NOT_COMPLETED', 'Chỉ phát hành hóa đơn cho giao dịch thanh toán thành công');
  const existing = db.invoices.find((r) => r.paymentId === payment.id);
  if (existing) return existing;

  const total = orders.reduce((s, o) => s + o.finalAmount, 0);
  const vat = orders.reduce((s, o) => s + o.vatAmount, 0);
  const id = ++db.seq.invoice;
  const buyerName = buyer?.buyerName?.trim() || 'Khách lẻ'; // hóa đơn bán lẻ khi không ghi thông tin người mua
  const yy = at.slice(2, 4);
  const invoice: Invoice = {
    id,
    invoiceNumber: `SC-${at.slice(0, 4)}-${pad(id, 5)}`,
    symbol: `C${yy}TSC`,
    templateCode: '1/001',
    buyerName,
    buyerTaxCode: buyer?.buyerTaxCode?.trim() || null,
    buyerAddress: buyer?.buyerAddress?.trim() || null,
    email: buyer?.email?.trim() || null,
    subtotalAmount: total - vat,
    vatRate: VAT_RATE,
    vatAmount: vat,
    totalAmount: total,
    lookupCode: `SCLK${pad(id, 6)}`,
    pdfUrl: null, // mock: không có file PDF thật
    status: 'Issued',
    relatedInvoiceId: null,
    relationType: null,
    issuedAt: at,
    createdAt: at,
  };

  let lineNo = 0;
  const items: InvoiceItem[] = orders.flatMap((o) =>
    o.items.map((i) => ({
      id: ++db.seq.invoiceItem, invoiceId: id, lineNo: ++lineNo, description: describeItem(i), unit: null,
      quantity: i.quantity, unitPrice: i.unitPrice + i.optionsUnitTotal, amount: i.lineTotal, vatRate: VAT_RATE,
    })),
  );

  const record: MockInvoiceRecord = { invoice, paymentId: payment.id, orderIds: orders.map((o) => o.id), items };
  db.invoices.push(record);
  return record;
}

export interface RecordPaymentArgs {
  orders: OrderDetail[];
  method: PaymentMethod;
  cashReceived?: number;
  createdBy?: string | null;
  idempotencyKey?: string | null;
  invoice?: InvoiceRequestInput;
  /** Mặc định: bây giờ. Seed truyền thời điểm của đơn. */
  at?: string;
}

/** Ghi payment (Success) + allocation + hóa đơn. KHÔNG sửa đơn — gọi `markOrdersPaid` riêng khi là giao dịch mới. */
export function recordPayment(args: RecordPaymentArgs): PayResult {
  const at = args.at ?? nowNaive();
  const amount = args.orders.reduce((s, o) => s + o.finalAmount, 0);
  const isCash = args.method === 'Cash';
  const id = ++db.seq.payment;
  const payment: Payment = {
    id,
    branchId: args.orders[0]!.branchId,
    cashierShiftId: null, // chưa mock ca thu ngân
    idempotencyKey: args.idempotencyKey ?? null,
    paymentMethod: args.method,
    amount,
    refundedAmount: 0,
    cashReceived: isCash ? (args.cashReceived ?? amount) : null,
    changeAmount: isCash ? (args.cashReceived ?? amount) - amount : null,
    collectedBy: isCash ? (args.createdBy ?? null) : null,
    transactionId: GATEWAY_METHODS.includes(args.method) ? `MOCK-${args.method.toUpperCase()}-${pad(id, 6)}` : null,
    status: 'Success',
    expiresAt: null,
    paidAt: at,
    createdBy: args.createdBy ?? null,
    createdAt: at,
    updatedAt: at,
  };
  db.payments.push(payment);

  const allocations = args.orders.map((o) => ({
    id: ++db.seq.allocation, paymentId: id, orderId: o.id, allocatedAmount: o.finalAmount, createdAt: at,
  }));
  db.allocations.push(...allocations);

  const record = issueInvoice(payment, args.orders, args.invoice, at);
  return { payment, allocations, redirectUrl: null, invoice: record.invoice };
}

/** Cập nhật trạng thái thanh toán của đơn sau giao dịch mới; version tăng như mọi thay đổi khác của đơn. */
export function markOrdersPaid(orders: OrderDetail[], at: string, opts: { online?: boolean } = {}): void {
  for (const o of orders) {
    o.paymentStatus = 'Paid';
    if (opts.online) o.paidOnline = true;
    o.version += 1;
    o.updatedAt = at;
  }
}

/** Route nội bộ của trang cổng thanh toán giả lập (mock không redirect ra cổng ngoài). */
export const gatewayRedirectUrl = (orderId: number, paymentId: number): string => `/payment/${orderId}?paymentId=${paymentId}`;

/** Kết quả của một giao dịch đã có (replay theo idempotencyKey, polling). Giao dịch đang chờ vẫn mang redirectUrl. */
export function resultOfPayment(payment: Payment): PayResult {
  const rec = db.invoices.find((r) => r.paymentId === payment.id);
  const allocations = db.allocations.filter((a) => a.paymentId === payment.id);
  const first = allocations[0];
  const redirectUrl = payment.status === 'Pending' && first ? gatewayRedirectUrl(first.orderId, payment.id) : null;
  return { payment, allocations, redirectUrl, invoice: rec?.invoice ?? null };
}

// ── Giao dịch cổng thanh toán giả lập (VNPay/Momo) ─────────────────────
/** Đơn của một giao dịch (theo allocation). */
export const ordersOfPayment = (payment: Payment): OrderDetail[] =>
  db.allocations
    .filter((a) => a.paymentId === payment.id)
    .map((a) => db.orders.find((o) => o.id === a.orderId))
    .filter((o): o is OrderDetail => !!o);

/**
 * Đưa giao dịch Pending về đúng trạng thái hiện tại (gọi trước mỗi lần đọc/ghi, đồng bộ):
 * - quá hạn → Expired;
 * - đơn đã được thanh toán bằng giao dịch khác (vd. thu tiền mặt tại quầy trong lúc chờ) → Cancelled.
 */
export function reconcilePayment(payment: Payment): Payment {
  if (payment.status !== 'Pending') return payment;
  const at = nowNaive();
  if (isExpired(payment.expiresAt)) {
    payment.status = 'Expired';
    payment.updatedAt = at;
  } else if (ordersOfPayment(payment).some((o) => PAID_STATUSES.has(o.paymentStatus))) {
    payment.status = 'Cancelled';
    payment.updatedAt = at;
  }
  return payment;
}

/** Giao dịch cổng thanh toán còn hiệu lực (Pending) của đơn, nếu có. */
export function livePendingPaymentOf(orderId: number, method: PaymentMethod): Payment | undefined {
  for (const a of db.allocations) {
    if (a.orderId !== orderId) continue;
    const p = db.payments.find((x) => x.id === a.paymentId);
    if (p && p.paymentMethod === method && reconcilePayment(p).status === 'Pending') return p;
  }
  return undefined;
}

/** Ném đúng lỗi nghiệp vụ nếu đơn không thể trả qua cổng thanh toán. */
export function assertGatewayPayable(o: OrderDetail): void {
  if (PAID_STATUSES.has(o.paymentStatus)) {
    fail(409, 'ORDER_ALREADY_PAID', `Đơn ${o.orderCode} đã được thanh toán`);
  }
  if (o.orderSource === 'Online') {
    fail(409, 'ORDER_NOT_PAYABLE', `Đơn Online ${o.orderCode} thanh toán qua luồng riêng, không dùng cổng này`);
  }
  if (o.status === 'Pending_Payment' || isTerminalOrderStatus(o.status)) {
    fail(409, 'ORDER_NOT_PAYABLE', `Đơn ${o.orderCode} đang ở trạng thái ${o.status}, không thể thanh toán`);
  }
}

export interface CreateGatewayPaymentArgs {
  orders: OrderDetail[];
  method: PaymentMethod;
  createdBy?: string | null;
  idempotencyKey?: string | null;
  invoice?: InvoiceRequestInput;
}

/** Tạo giao dịch Pending + allocation. Số tiền luôn tính từ đơn; KHÔNG sửa đơn, KHÔNG phát hóa đơn (chờ IPN). */
export function createGatewayPayment(args: CreateGatewayPaymentArgs): PayResult {
  const at = nowNaive();
  const id = ++db.seq.payment;
  const payment: Payment = {
    id,
    branchId: args.orders[0]!.branchId,
    cashierShiftId: null,
    idempotencyKey: args.idempotencyKey ?? null,
    paymentMethod: args.method,
    amount: args.orders.reduce((s, o) => s + o.finalAmount, 0),
    refundedAmount: 0,
    cashReceived: null,
    changeAmount: null,
    collectedBy: null,
    transactionId: null, // chỉ có sau khi cổng báo thành công
    status: 'Pending',
    expiresAt: nowNaive(GATEWAY_PAYMENT_TTL_MS),
    paidAt: null,
    createdBy: args.createdBy ?? null,
    createdAt: at,
    updatedAt: at,
  };
  db.payments.push(payment);
  db.allocations.push(...args.orders.map((o) => ({
    id: ++db.seq.allocation, paymentId: id, orderId: o.id, allocatedAmount: o.finalAmount, createdAt: at,
  })));
  if (args.invoice) db.invoiceRequests[id] = args.invoice;
  return resultOfPayment(payment);
}

/**
 * IPN giả: chốt một giao dịch đang Pending. Đồng bộ (không await) nên hai IPN đến cùng lúc xử lý lần lượt.
 * success → Success + đơn Paid (đánh dấu paidOnline) + hóa đơn như nhánh Cash; failed/expired → đơn vẫn Unpaid.
 */
export function settleGatewayPayment(payment: Payment, result: 'success' | 'failed' | 'expired'): PayResult {
  const at = nowNaive();
  if (result === 'failed') {
    payment.status = 'Failed';
  } else if (result === 'expired') {
    payment.status = 'Expired';
  } else {
    const orders = ordersOfPayment(payment);
    const paid = orders.find((o) => PAID_STATUSES.has(o.paymentStatus));
    if (paid) {
      payment.status = 'Cancelled';
      payment.updatedAt = at;
      fail(409, 'ORDER_ALREADY_PAID', `Đơn ${paid.orderCode} đã được thanh toán, giao dịch này bị hủy`);
    }
    payment.status = 'Success';
    payment.paidAt = at;
    payment.transactionId = `MOCK-${payment.paymentMethod.toUpperCase()}-${pad(payment.id, 6)}`;
    markOrdersPaid(orders, at, { online: true });
    issueInvoice(payment, orders, db.invoiceRequests[payment.id], at);
  }
  payment.updatedAt = at;
  return resultOfPayment(payment);
}

/** Ghép hóa đơn với payment/đơn thật để UI đối chiếu. */
export function buildInvoiceDetail(rec: MockInvoiceRecord): InvoiceDetail {
  const payment = db.payments.find((p) => p.id === rec.paymentId);
  if (!payment?.paidAt) fail(409, 'PAYMENT_NOT_COMPLETED', 'Giao dịch của hóa đơn chưa hoàn tất');
  const orders = rec.orderIds.map((id) => db.orders.find((o) => o.id === id)).filter((o): o is OrderDetail => !!o);
  return {
    ...rec.invoice,
    paymentId: payment.id,
    paymentMethod: payment.paymentMethod,
    paymentStatus: payment.status,
    paidAt: payment.paidAt,
    orders: orders.map((o) => ({ id: o.id, orderCode: o.orderCode })),
    items: rec.items,
    grossAmount: orders.reduce((s, o) => s + o.subTotal, 0),
    discountAmount: orders.reduce((s, o) => s + o.itemDiscountAmount + o.voucherDiscountAmount, 0),
    deliveryFee: orders.reduce((s, o) => s + o.deliveryFee, 0),
  };
}
