import { orderApi } from '@/shared/api';
import type { CreateQrDineInOrderInput, OrderDetail } from '@/shared/types';
import { useAuthStore } from '@/features/auth/store';
import { toOrderLines, type DineInCartLine } from './cart';
import { DINE_IN_BRANCH_ID } from './config';
import { usePlacedOrders } from './placed-orders';
import { useDineInCartStore } from './store';

export type SubmitErrorCode = 'EMPTY_CART' | 'NO_SESSION' | 'NOT_SIGNED_IN' | 'MISSING_DELIVERY' | 'NO_FULFILLMENT';

/** Lỗi do FE chặn trước khi gọi API (khác với ApiError từ server). */
export class SubmitOrderError extends Error {
  readonly code: SubmitErrorCode;
  constructor(code: SubmitErrorCode, message: string) {
    super(message);
    this.name = 'SubmitOrderError';
    this.code = code;
  }
}

export const MAX_NOTE_LENGTH = 300;

export function buildCreateOrderInput(args: {
  tableSessionId: number;
  lines: readonly DineInCartLine[];
  note?: string;
  userId?: string;
  idempotencyKey: string;
}): CreateQrDineInOrderInput {
  const note = args.note?.trim();
  return {
    orderSource: 'QR',
    fulfillmentType: 'Dine_In',
    branchId: DINE_IN_BRANCH_ID,
    tableSessionId: args.tableSessionId,
    lines: toOrderLines(args.lines),
    idempotencyKey: args.idempotencyKey,
    ...(note ? { note } : {}),
    ...(args.userId ? { userId: args.userId } : {}),
  };
}

// ── Chống tạo đơn trùng ───────────────────────────────────────────────
// 1) Đang gửi thì mọi lời gọi thêm dùng chung 1 promise (bấm liên tục / double-submit).
// 2) Cùng nội dung giỏ + ghi chú → cùng idempotencyKey, nên gửi lại sau lỗi mạng
//    (server có thể đã tạo đơn nhưng response bị mất) không sinh đơn thứ hai.
let attempt: { signature: string; key: string } | null = null;
let inflight: { signature: string; promise: Promise<OrderDetail> } | null = null;

const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function keyFor(signature: string): string {
  if (!attempt || attempt.signature !== signature) attempt = { signature, key: newKey() };
  return attempt.key;
}

/** Chỉ dành cho test. */
export function resetSubmitState(): void {
  attempt = null;
  inflight = null;
}

/**
 * Gửi giỏ hiện tại thành đơn Dine-in qua đúng API tạo đơn (cùng db với hàng đợi nhân viên).
 * Chỉ xoá giỏ SAU KHI server trả đơn thành công; lỗi thì giỏ giữ nguyên để thử lại.
 */
export function placeDineInOrder(opts: { note?: string } = {}): Promise<OrderDetail> {
  const { tableSessionId, tableCode, sessionCode, lines } = useDineInCartStore.getState();
  if (tableSessionId === null) {
    return Promise.reject(new SubmitOrderError('NO_SESSION', 'Chưa có phiên bàn. Vui lòng quét lại mã QR trên bàn.'));
  }
  if (lines.length === 0) {
    return Promise.reject(new SubmitOrderError('EMPTY_CART', 'Giỏ hàng đang trống.'));
  }

  const signature = JSON.stringify([tableSessionId, toOrderLines(lines), opts.note?.trim() ?? '']);
  if (inflight?.signature === signature) return inflight.promise;

  const { user, roleName } = useAuthStore.getState();
  const input = buildCreateOrderInput({
    tableSessionId,
    lines,
    note: opts.note,
    ...(user && roleName === 'Customer' ? { userId: user.id } : {}),
    idempotencyKey: keyFor(signature),
  });

  const promise = orderApi
    .createOrder(input)
    .then((order) => {
      usePlacedOrders.getState().record(order, { sessionCode, tableCode });
      useDineInCartStore.getState().clear();
      attempt = null;
      return order;
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  inflight = { signature, promise };
  return promise;
}
