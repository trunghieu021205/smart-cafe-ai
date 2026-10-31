import { AlertTriangle } from 'lucide-react';
import { formatVnd } from '@/shared/lib';
import { cn } from '@/shared/lib/cn';
import type { InventoryItemView } from '@/shared/types';
import { formatQty, isAttention, statusOfItem } from '../model';
import { StockStatusBadge } from './StockStatusBadge';

const th = 'px-4 py-3 text-left text-caption font-semibold uppercase tracking-wide text-gray-600';
const thNum = `${th} text-right`;
const td = 'px-4 py-3 text-body text-gray-800';
const tdNum = `${td} text-right tabular-nums`;

interface Props {
  items: InventoryItemView[];
  selectedId: number | null;
  onSelect: (ingredientId: number) => void;
}

export function StockTable({ items, selectedId, onSelect }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-card">
      <table className="w-full min-w-[880px] border-collapse">
        <caption className="sr-only">Tồn kho nguyên liệu theo chi nhánh</caption>
        <thead className="bg-primary-50">
          <tr>
            <th scope="col" className={th}>Nguyên liệu</th>
            <th scope="col" className={th}>Đơn vị</th>
            <th scope="col" className={thNum}>Tồn kho</th>
            <th scope="col" className={thNum}>Đang giữ</th>
            <th scope="col" className={thNum}>Khả dụng</th>
            <th scope="col" className={thNum}>Ngưỡng cảnh báo</th>
            <th scope="col" className={thNum}>Giá vốn TB</th>
            <th scope="col" className={th}>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const status = statusOfItem(item);
            return (
              <tr
                key={item.ingredientId}
                onClick={() => onSelect(item.ingredientId)}
                aria-selected={selectedId === item.ingredientId}
                className={cn(
                  'cursor-pointer border-t border-gray-100 transition-colors',
                  status === 'out' && 'bg-error-soft/50 hover:bg-error-soft',
                  status === 'low' && 'bg-warning-soft/40 hover:bg-warning-soft/70',
                  status === 'ok' && 'hover:bg-gray-50',
                  selectedId === item.ingredientId && 'ring-2 ring-inset ring-primary-300',
                )}
              >
                <td className={td}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(item.ingredientId);
                    }}
                    className="inline-flex items-center gap-2 rounded-sm text-left font-medium text-gray-900 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                  >
                    {isAttention(status) && (
                      <AlertTriangle aria-hidden className={cn('size-4 shrink-0', status === 'out' ? 'text-error' : 'text-warning')} />
                    )}
                    {item.ingredientName}
                  </button>
                </td>
                <td className={td}>{item.unit}</td>
                <td className={tdNum}>{formatQty(item.quantityInStock)}</td>
                <td className={tdNum}>{formatQty(item.reservedQuantity)}</td>
                <td className={cn(tdNum, 'font-semibold', status === 'out' ? 'text-error-strong' : status === 'low' ? 'text-warning-strong' : 'text-gray-900')}>
                  {formatQty(item.available)}
                </td>
                <td className={tdNum}>{formatQty(item.reorderLevel)}</td>
                <td className={tdNum}>{`${formatVnd(item.averageCost)}/${item.unit}`}</td>
                <td className={td}>
                  <StockStatusBadge status={status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
