import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, History, SlidersHorizontal, X } from 'lucide-react';
import { isApiError } from '@/shared/api';
import { formatVnd, parseUtc } from '@/shared/lib';
import { cn } from '@/shared/lib/cn';
import type { InventoryItemView, InventoryLog } from '@/shared/types';
import { Badge, Button, Skeleton, type BadgeTone } from '@/shared/ui';
import { useInventoryLogs } from '../hooks/useInventory';
import {
  countLogsBySource, dailyConsumption, filterLogsBySource, formatLogReference, formatQty, formatSignedQty, LOG_SOURCE_FILTERS,
  LOG_SOURCE_LABEL, LOG_TYPE_LABEL, logSourceOf, statusOfItem, type LogSource, type LogSourceFilter,
} from '../model';
import { ConsumptionChart } from './ConsumptionChart';
import { StockStatusBadge } from './StockStatusBadge';

const SOURCE_TONE: Record<LogSource, BadgeTone> = { auto: 'info', import: 'success', manual: 'primary' };

const TIME = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const formatTime = (iso: string): string => {
  const d = parseUtc(iso);
  return d ? TIME.format(d) : '—';
};

interface Props {
  branchId: number;
  item: InventoryItemView;
  onClose: () => void;
  onAdjust: () => void;
}

export function InventoryDrawer({ branchId, item, onClose, onAdjust }: Props) {
  const logs = useInventoryLogs(branchId, item.ingredientId);
  const [source, setSource] = useState<LogSourceFilter>('all');
  const closeRef = useRef<HTMLButtonElement>(null);
  const status = statusOfItem(item);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // `now` lấy lúc dữ liệu log được tải: render thuần, biểu đồ đổi khi refetch.
  const chart = useMemo(() => dailyConsumption(logs.data ?? [], new Date(logs.dataUpdatedAt || 0)), [logs.data, logs.dataUpdatedAt]);
  const counts = useMemo(() => countLogsBySource(logs.data ?? []), [logs.data]);
  const visible = useMemo(() => filterLogsBySource(logs.data ?? [], source), [logs.data, source]);

  return (
    <div className="fixed inset-0 z-40">
      <div aria-hidden className="absolute inset-0 bg-gray-900/40" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-drawer-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-modal"
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-6 py-4">
          <div className="min-w-0 space-y-1">
            <h2 id="inventory-drawer-title" className="truncate text-h3 text-gray-900">{item.ingredientName}</h2>
            <div className="flex items-center gap-2">
              <StockStatusBadge status={status} />
              <span className="text-caption text-gray-500">Đơn vị: {item.unit}</span>
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Đóng chi tiết" className="rounded-sm p-1 text-gray-500 hover:bg-gray-100">
            <X className="size-5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Tồn kho" value={`${formatQty(item.quantityInStock)} ${item.unit}`} />
            <Stat label="Đang giữ" value={`${formatQty(item.reservedQuantity)} ${item.unit}`} />
            <Stat label="Khả dụng" value={`${formatQty(item.available)} ${item.unit}`} emphasis={status} />
            <Stat label="Ngưỡng cảnh báo" value={`${formatQty(item.reorderLevel)} ${item.unit}`} />
            <Stat label="Giá vốn TB" value={`${formatVnd(item.averageCost)}/${item.unit}`} />
          </dl>

          <Button onClick={onAdjust} leftIcon={<SlidersHorizontal className="size-4" />}>
            Điều chỉnh kho
          </Button>

          <section aria-labelledby="consumption-title" className="space-y-2">
            <h3 id="consumption-title" className="text-h4 text-gray-900">Tiêu thụ 7 ngày</h3>
            {logs.isPending ? (
              <Skeleton className="h-36 w-full" />
            ) : logs.isError ? null : (
              <ConsumptionChart data={chart} unit={item.unit} />
            )}
          </section>

          <section aria-labelledby="history-title" className="space-y-3">
            <h3 id="history-title" className="flex items-center gap-2 text-h4 text-gray-900">
              <History aria-hidden className="size-4 text-gray-500" /> Lịch sử biến động
            </h3>

            <div role="group" aria-label="Lọc theo nguồn log" className="flex flex-wrap gap-2">
              {LOG_SOURCE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={source === f.id}
                  onClick={() => setSource(f.id)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-caption font-medium transition-colors',
                    source === f.id ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                  )}
                >
                  {f.label} ({counts[f.id]})
                </button>
              ))}
            </div>

            <LogBody
              loading={logs.isPending}
              error={logs.isError ? (isApiError(logs.error) ? logs.error.message : 'Không tải được lịch sử') : null}
              onRetry={() => void logs.refetch()}
              total={logs.data?.length ?? 0}
              logs={visible}
              unit={item.unit}
              onClearFilter={() => setSource('all')}
            />
          </section>
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: 'out' | 'low' | 'ok' }) {
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2">
      <dt className="text-caption text-gray-500">{label}</dt>
      <dd className={cn('text-body font-semibold tabular-nums', emphasis === 'out' ? 'text-error-strong' : emphasis === 'low' ? 'text-warning-strong' : 'text-gray-900')}>
        {value}
      </dd>
    </div>
  );
}

interface LogBodyProps {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  total: number;
  logs: InventoryLog[];
  unit: string;
  onClearFilter: () => void;
}

function LogBody({ loading, error, onRetry, total, logs, unit, onClearFilter }: LogBodyProps) {
  if (loading) {
    return (
      <div className="space-y-2" role="status" aria-label="Đang tải lịch sử">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-error/30 bg-error-soft px-4 py-3 text-body text-error-strong">
        <span className="flex items-center gap-2"><AlertTriangle aria-hidden className="size-4" /> {error}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>Thử lại</Button>
      </div>
    );
  }
  if (total === 0) {
    return <p className="rounded-md bg-gray-50 px-4 py-6 text-center text-body text-gray-500">Nguyên liệu này chưa có biến động nào.</p>;
  }
  if (logs.length === 0) {
    return (
      <div className="rounded-md bg-gray-50 px-4 py-6 text-center text-body text-gray-500">
        Không có log nào thuộc nhóm này.{' '}
        <button type="button" onClick={onClearFilter} className="font-medium text-primary-700 underline">Xem tất cả</button>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
      {logs.map((log) => {
        const src = logSourceOf(log.transactionType);
        const ref = formatLogReference(log);
        return (
          <li key={log.id} className="space-y-1 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-body font-medium text-gray-900">{LOG_TYPE_LABEL[log.transactionType]}</span>
                <Badge tone={SOURCE_TONE[src]}>{LOG_SOURCE_LABEL[src]}</Badge>
              </span>
              <span className={cn('text-body font-semibold tabular-nums', log.quantityChanged < 0 ? 'text-error-strong' : 'text-success-strong')}>
                {formatSignedQty(log.quantityChanged)} {unit}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-caption text-gray-500">
              <span>{formatTime(log.createdAt)}{ref ? ` · ${ref}` : ''}</span>
              <span className="tabular-nums">Tồn sau: {formatQty(log.balanceAfter)} {unit}</span>
            </div>
            {log.reason && <p className="text-caption text-gray-600">Lý do: {log.reason}</p>}
          </li>
        );
      })}
    </ul>
  );
}
