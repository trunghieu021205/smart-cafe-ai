import type {
  CashMovement,
  CashMovementInput,
  CashierShift,
  CloseCashierShiftInput,
  CreateRefundInput,
  InvoiceDetail,
  OpenCashierShiftInput,
  PayOrdersInput,
  PayResult,
  Refund,
  SimulatePaymentInput,
} from '@/shared/types';
import { http } from './http';

const P = '/payment';

/** Khách guest quét QR bàn chứng minh quyền với đơn Dine-in của mình bằng sessionCode của phiên bàn. */
export interface PaymentCallOptions {
  sessionCode?: string | null;
  signal?: AbortSignal;
}

const callOptions = (o?: PaymentCallOptions) => ({
  ...(o?.sessionCode ? { headers: { 'X-Table-Session-Code': o.sessionCode } } : {}),
  ...(o?.signal ? { signal: o.signal } : {}),
});

/** 1..N đơn; VNPay/Momo trả `redirectUrl`. */
export const payOrders = (input: PayOrdersInput, opts?: PaymentCallOptions) =>
  http.post<PayResult>(`${P}/payments`, input, callOptions(opts));

/** Trạng thái một giao dịch (polling của trang cổng thanh toán). */
export const getPayment = (id: number, opts?: PaymentCallOptions) => http.get<PayResult>(`${P}/payments/${id}`, callOptions(opts));

/** MOCK: đóng vai IPN của cổng thanh toán. Backend thật không có endpoint này. */
export const simulatePayment = (id: number, input: SimulatePaymentInput, opts?: PaymentCallOptions) =>
  http.post<PayResult>(`${P}/payments/${id}/simulate`, input, callOptions(opts));

/**
 * Hóa đơn điện tử của giao dịch thanh toán thành công của đơn. Chỉ đọc: không bao giờ tạo hóa đơn mới
 * (hóa đơn được phát hành đúng 1 lần cùng giao dịch). 404 ORDER_NOT_FOUND | INVOICE_NOT_FOUND,
 * 409 PAYMENT_NOT_COMPLETED khi đơn chưa có giao dịch thành công.
 */
export const getInvoiceByOrder = (orderId: number, signal?: AbortSignal) =>
  http.get<InvoiceDetail>(`${P}/invoices`, { query: { orderId }, signal });

// Cashier shift
export const getCurrentCashierShift = (branchId: number, registerCode?: string) =>
  http.get<CashierShift | null>(`${P}/cashier-shifts/current`, { query: { branchId, registerCode } });
export const openCashierShift = (input: OpenCashierShiftInput) => http.post<CashierShift>(`${P}/cashier-shifts`, input);
export const closeCashierShift = (id: number, input: CloseCashierShiftInput) =>
  http.post<CashierShift>(`${P}/cashier-shifts/${id}/close`, input);
export const listCashMovements = (shiftId: number) => http.get<CashMovement[]>(`${P}/cashier-shifts/${shiftId}/movements`);
export const addCashMovement = (shiftId: number, input: CashMovementInput) =>
  http.post<CashMovement>(`${P}/cashier-shifts/${shiftId}/movements`, input);

// Refund
export const createRefund = (input: CreateRefundInput) => http.post<Refund>(`${P}/refunds`, input);