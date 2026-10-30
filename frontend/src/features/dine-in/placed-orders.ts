import { create } from 'zustand';
import type { OrderDetail } from '@/shared/types';

/**
 * Đơn khách vừa đặt, giữ trong sessionStorage để trang xác nhận F5 vẫn hiển thị được
 * mà KHÔNG phải gửi lại đơn (trang đó chỉ đọc, không bao giờ POST).
 * Khách không có API xem đơn nên đây là nguồn dữ liệu duy nhất cho màn hình xác nhận.
 */
const STORAGE_KEY = 'smartcafe.dinein.placed';
const META_KEY = 'smartcafe.dinein.placed-meta';
const MAX_KEPT = 5;

function load(): OrderDetail[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as OrderDetail[]) : [];
  } catch {
    return [];
  }
}

function save(orders: OrderDetail[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  } catch {
    /* storage bị chặn → chỉ sống trong RAM */
  }
}

/**
 * Ngữ cảnh bàn của từng đơn vừa đặt (orderId → mã phiên bàn + mã QR bàn): trang thanh toán cần mã phiên để chứng minh quyền
 * của khách guest, và cần mã QR bàn để quay về đúng thực đơn — cả hai phải sống qua F5. Chỉ giữ cho các đơn còn trong danh sách trên.
 */
export interface PlacedOrderMeta {
  sessionCode?: string | null;
  tableCode?: string | null;
}

function loadMeta(): Record<string, PlacedOrderMeta> {
  try {
    const raw = sessionStorage.getItem(META_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, PlacedOrderMeta>) : {};
  } catch {
    return {};
  }
}

function saveMeta(meta: Record<string, PlacedOrderMeta>): void {
  try {
    sessionStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* storage bị chặn → bỏ qua */
  }
}

export const placedOrderMeta = (orderId: number): PlacedOrderMeta => loadMeta()[String(orderId)] ?? {};

interface PlacedOrdersState {
  orders: OrderDetail[];
  record: (order: OrderDetail, meta?: PlacedOrderMeta) => void;
  get: (orderId: number) => OrderDetail | undefined;
}

export const usePlacedOrders = create<PlacedOrdersState>((set, get) => ({
  orders: load(),
  record: (order, meta) => {
    const next = [order, ...get().orders.filter((o) => o.id !== order.id)].slice(0, MAX_KEPT);
    save(next);
    const kept = new Set(next.map((o) => String(o.id)));
    const all = Object.fromEntries(Object.entries(loadMeta()).filter(([id]) => kept.has(id)));
    if (meta && (meta.sessionCode || meta.tableCode)) all[String(order.id)] = meta;
    saveMeta(all);
    set({ orders: next });
  },
  get: (orderId) => get().orders.find((o) => o.id === orderId),
}));
