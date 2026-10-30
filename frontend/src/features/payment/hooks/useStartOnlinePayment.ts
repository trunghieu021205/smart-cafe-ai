import { useCallback, useRef, useState } from 'react';
import { isApiError, paymentApi } from '@/shared/api';
import { to } from '@/app/routes';
import type { PaymentMethod } from '@/shared/types';
import { ONLINE_PAYMENT_METHOD } from '../config';

const newKey = (orderId: number) =>
  `dinein-online-${orderId}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/** Thông báo cho khách khi không tạo được giao dịch online. */
export function describePaymentError(err: unknown): string {
  if (isApiError(err)) {
    if (err.status === 0) return 'Không thể kết nối tới cổng thanh toán. Vui lòng kiểm tra mạng và thử lại.';
    if (err.is('ORDER_ALREADY_PAID')) return 'Đơn này đã được thanh toán.';
    if (err.status === 403) return 'Phiên bàn không còn hợp lệ. Vui lòng báo nhân viên để thanh toán tại quầy.';
    return err.message;
  }
  return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}

/** Đường dẫn trang cổng thanh toán của một giao dịch (nội bộ: mock không chuyển hướng ra cổng ngoài). */
export function gatewayPath(orderId: number, paymentId: number, redirectUrl?: string | null): string {
  return redirectUrl?.startsWith('/') ? redirectUrl : `${to.payment(String(orderId))}?paymentId=${paymentId}`;
}

export type StartPaymentResult = { path: string; error: null } | { path: null; error: string };

/**
 * Tạo giao dịch cổng thanh toán cho đơn Dine-in ĐÃ ĐẶT; trả về đường dẫn tới trang cổng, hoặc thông báo lỗi.
 * Chống bấm lặp bằng cờ đồng bộ (lần gọi thừa trả về lỗi rỗng-an toàn); số tiền do server tính từ đơn, client không gửi.
 */
export function useStartOnlinePayment() {
  const [isStarting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const start = useCallback(
    async (orderId: number, sessionCode?: string | null, method: PaymentMethod = ONLINE_PAYMENT_METHOD): Promise<StartPaymentResult> => {
      if (busy.current) return { path: null, error: 'Đang xử lý, vui lòng đợi giây lát.' };
      busy.current = true;
      setStarting(true);
      setError(null);
      try {
        const res = await paymentApi.payOrders({ orderIds: [orderId], method, idempotencyKey: newKey(orderId) }, { sessionCode });
        return { path: gatewayPath(orderId, res.payment.id, res.redirectUrl), error: null };
      } catch (e) {
        const message = describePaymentError(e);
        setError(message);
        return { path: null, error: message };
      } finally {
        busy.current = false;
        setStarting(false);
      }
    },
    [],
  );

  return { start, isStarting, error };
}
