import type { PaymentMethod } from '@/shared/types';

/** Giai đoạn này chỉ có cổng VNPay giả lập; Momo đã được mock backend hỗ trợ nhưng chưa có lựa chọn trên UI. */
export const ONLINE_PAYMENT_METHOD: PaymentMethod = 'VNPay';

/** Trang cổng thanh toán hỏi lại trạng thái giao dịch mỗi 3 giây tới khi có kết quả (IPN mới là nguồn sự thật). */
export const PAYMENT_POLL_MS = 3_000;
