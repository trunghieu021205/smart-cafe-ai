import { z } from 'zod';
import { parseUtc } from '@/shared/lib';
import type { InventoryItemView, InventoryLog, InventoryTransactionType } from '@/shared/types';

// ── Trạng thái tồn kho ────────────────────────────────────────────────
/** out: Hết hàng (available ≤ 0) · low: Sắp hết (available ≤ ngưỡng cảnh báo) · ok: Ổn. */
export type StockStatus = 'out' | 'low' | 'ok';

export function stockStatus(available: number, reorderLevel: number): StockStatus {
  if (available <= 0) return 'out';
  if (available <= reorderLevel) return 'low';
  return 'ok';
}

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  out: 'Hết hàng',
  low: 'Sắp hết',
  ok: 'Ổn',
};

export const statusOfItem = (item: Pick<InventoryItemView, 'available' | 'reorderLevel'>): StockStatus =>
  stockStatus(item.available, item.reorderLevel);

export const isAttention = (status: StockStatus): boolean => status !== 'ok';

// ── Tìm kiếm / lọc danh sách ──────────────────────────────────────────
/** Bỏ dấu + thường hoá để gõ "ca phe" vẫn ra "Cà phê". */
export const foldText = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase().trim();

export interface StockFilter {
  q: string;
  /** Chỉ hàng "Sắp hết" và "Hết hàng". */
  lowOnly: boolean;
}

export function filterStock(items: InventoryItemView[], { q, lowOnly }: StockFilter): InventoryItemView[] {
  const needle = foldText(q);
  return items.filter(
    (item) => (needle === '' || foldText(item.ingredientName).includes(needle)) && (!lowOnly || isAttention(statusOfItem(item))),
  );
}

export function countByStatus(items: InventoryItemView[]): Record<StockStatus, number> {
  const counts: Record<StockStatus, number> = { out: 0, low: 0, ok: 0 };
  for (const item of items) counts[statusOfItem(item)] += 1;
  return counts;
}

// ── Nguồn log ─────────────────────────────────────────────────────────
/** Tự động (hệ thống) · Nhập hàng · Thủ công (người dùng tự ghi). */
export type LogSource = 'auto' | 'import' | 'manual';
export type LogSourceFilter = LogSource | 'all';

const SOURCE_BY_TYPE: Record<InventoryTransactionType, LogSource> = {
  Auto_Deduct: 'auto',
  Refund: 'auto',
  Import: 'import',
  Adjustment: 'manual',
  Waste: 'manual',
  Stocktake: 'manual',
};

export const logSourceOf = (type: InventoryTransactionType): LogSource => SOURCE_BY_TYPE[type];

export const LOG_SOURCE_LABEL: Record<LogSource, string> = {
  auto: 'Tự động',
  import: 'Nhập hàng',
  manual: 'Thủ công',
};

export const LOG_SOURCE_FILTERS: { id: LogSourceFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'auto', label: LOG_SOURCE_LABEL.auto },
  { id: 'import', label: LOG_SOURCE_LABEL.import },
  { id: 'manual', label: LOG_SOURCE_LABEL.manual },
];

export const LOG_TYPE_LABEL: Record<InventoryTransactionType, string> = {
  Import: 'Nhập hàng',
  Auto_Deduct: 'Trừ kho theo đơn',
  Refund: 'Hoàn kho (huỷ đơn)',
  Waste: 'Hao hụt',
  Adjustment: 'Điều chỉnh',
  Stocktake: 'Kiểm kê',
};

export function filterLogsBySource(logs: InventoryLog[], source: LogSourceFilter): InventoryLog[] {
  return source === 'all' ? logs : logs.filter((log) => logSourceOf(log.transactionType) === source);
}

export function countLogsBySource(logs: InventoryLog[]): Record<LogSourceFilter, number> {
  const counts: Record<LogSourceFilter, number> = { all: logs.length, auto: 0, import: 0, manual: 0 };
  for (const log of logs) counts[logSourceOf(log.transactionType)] += 1;
  return counts;
}

// ── Tiêu thụ 7 ngày ───────────────────────────────────────────────────
export interface DailyConsumption {
  /** YYYY-MM-DD theo giờ máy người dùng. */
  date: string;
  /** dd/MM */
  label: string;
  value: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Lượng tiêu thụ mỗi ngày = Σ trừ kho theo đơn (Auto_Deduct) − Σ hoàn kho (Refund), không âm.
 * Luôn trả đủ `days` mục từ cũ → mới, kết thúc ở ngày của `now` (ngày không có log = 0).
 */
export function dailyConsumption(logs: InventoryLog[], now: Date = new Date(), days = 7): DailyConsumption[] {
  const buckets: DailyConsumption[] = [];
  const index = new Map<string, DailyConsumption>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const bucket: DailyConsumption = { date: dayKey(d), label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`, value: 0 };
    buckets.push(bucket);
    index.set(bucket.date, bucket);
  }
  for (const log of logs) {
    if (log.transactionType !== 'Auto_Deduct' && log.transactionType !== 'Refund') continue;
    const at = parseUtc(log.createdAt);
    const bucket = at ? index.get(dayKey(at)) : undefined;
    if (bucket) bucket.value -= log.quantityChanged; // Auto_Deduct < 0 → cộng; Refund > 0 → trừ
  }
  for (const bucket of buckets) bucket.value = Math.max(0, bucket.value);
  return buckets;
}

// ── Form điều chỉnh kho ───────────────────────────────────────────────
export type AdjustType = 'Waste' | 'Adjustment' | 'Stocktake';

export const ADJUST_TYPE_OPTIONS: { value: AdjustType; label: string; hint: string }[] = [
  { value: 'Waste', label: 'Hao hụt / bỏ đi', hint: 'Nhập số âm: lượng nguyên liệu bị bỏ.' },
  { value: 'Adjustment', label: 'Điều chỉnh', hint: 'Nhập số âm để giảm, số dương để tăng.' },
  { value: 'Stocktake', label: 'Kiểm kê', hint: 'Nhập chênh lệch giữa thực tế và sổ sách (âm hoặc dương).' },
];

/** `currentStock`: tồn hiện tại, để chặn trước việc giảm vượt tồn (server vẫn kiểm tra lại). */
export const makeAdjustSchema = (currentStock: number) =>
  z
    .object({
      transactionType: z.enum(['Waste', 'Adjustment', 'Stocktake']),
      quantityChanged: z
        .number({ error: 'Nhập số lượng thay đổi' })
        .refine((n) => Number.isFinite(n), 'Số lượng không hợp lệ')
        .refine((n) => n !== 0, 'Số lượng thay đổi phải khác 0'),
      reason: z.string().trim().min(1, 'Vui lòng nhập lý do').max(255, 'Lý do tối đa 255 ký tự'),
    })
    .superRefine((value, ctx) => {
      if (value.transactionType === 'Waste' && value.quantityChanged >= 0) {
        ctx.addIssue({ code: 'custom', path: ['quantityChanged'], message: 'Hao hụt phải là số âm' });
      }
      if (currentStock + value.quantityChanged < 0) {
        ctx.addIssue({ code: 'custom', path: ['quantityChanged'], message: 'Giảm vượt quá tồn kho hiện có' });
      }
    });

export type AdjustFormValues = z.input<ReturnType<typeof makeAdjustSchema>>;

// ── Hiển thị ──────────────────────────────────────────────────────────
const NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
export const formatQty = (n: number): string => NUMBER.format(n);
export const formatSignedQty = (n: number): string => `${n > 0 ? '+' : ''}${NUMBER.format(n)}`;

/** "Order #7" / "PurchaseOrder PO-1001" / null khi không có tham chiếu. */
export function formatLogReference(log: Pick<InventoryLog, 'referenceType' | 'referenceId'>): string | null {
  if (!log.referenceId) return null;
  const label = log.referenceType === 'Order' ? 'Đơn' : log.referenceType === 'PurchaseOrder' ? 'Phiếu nhập' : (log.referenceType ?? '');
  return `${label} ${log.referenceType === 'Order' ? '#' : ''}${log.referenceId}`.trim();
}
