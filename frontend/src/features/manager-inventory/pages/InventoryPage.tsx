import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, PackageSearch, RefreshCw, Search, Warehouse } from 'lucide-react';
import { Toaster } from 'sonner';
import { useAuthStore } from '@/features/auth/store';
import { isApiError } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { Button, Card, Input, Skeleton } from '@/shared/ui';
import { AdjustModal } from '../components/AdjustModal';
import { InventoryDrawer } from '../components/InventoryDrawer';
import { StockTable } from '../components/StockTable';
import { useInventoryStock } from '../hooks/useInventory';
import { countByStatus, filterStock } from '../model';

export default function InventoryPage() {
  const branchId = useAuthStore((s) => s.branchId);
  const stock = useInventoryStock(branchId);
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  const items = useMemo(() => stock.data ?? [], [stock.data]);
  const counts = useMemo(() => countByStatus(items), [items]);
  const rows = useMemo(() => filterStock(items, { q, lowOnly }), [items, q, lowOnly]);
  const attention = counts.low + counts.out;
  const selected = items.find((i) => i.ingredientId === selectedId) ?? null;
  const filtering = q.trim() !== '' || lowOnly;

  const clearFilters = () => {
    setQ('');
    setLowOnly(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-caption text-gray-500">Quản lý / Kho</p>
        <h1 className="flex items-center gap-2 text-h2 text-gray-900">
          <Warehouse aria-hidden className="size-6 text-primary-600" /> Kho nguyên liệu
        </h1>
      </div>

      {branchId === null ? (
        <StateCard
          icon={<AlertTriangle className="size-8 text-warning" />}
          title="Tài khoản chưa được gán chi nhánh"
          description="Liên hệ quản trị viên để được gán chi nhánh trước khi xem kho."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 sm:max-w-sm">
              <Input
                aria-label="Tìm nguyên liệu"
                placeholder="Tìm nguyên liệu…"
                leftIcon={<Search />}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <button
              type="button"
              aria-pressed={lowOnly}
              onClick={() => setLowOnly((v) => !v)}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-md border px-4 text-body font-medium transition-colors',
                lowOnly ? 'border-warning bg-warning-soft text-warning-strong' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50',
              )}
            >
              <AlertTriangle aria-hidden className="size-4" />
              Sắp hết{stock.isSuccess ? ` (${attention})` : ''}
            </button>
            {stock.isSuccess && (
              <p className="pb-2 text-caption text-gray-500">
                {items.length} nguyên liệu · {counts.low} sắp hết · {counts.out} hết hàng
              </p>
            )}
          </div>

          {stock.isPending ? (
            <div role="status" aria-label="Đang tải kho" className="space-y-2 rounded-lg border border-gray-200 bg-white p-4 shadow-card">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : stock.isError ? (
            <StateCard
              icon={<AlertTriangle className="size-8 text-error" />}
              title="Không tải được dữ liệu kho"
              description={isApiError(stock.error) ? stock.error.message : 'Đã có lỗi xảy ra, vui lòng thử lại.'}
              action={
                <Button variant="outline" leftIcon={<RefreshCw className="size-4" />} onClick={() => void stock.refetch()} loading={stock.isFetching}>
                  Thử lại
                </Button>
              }
              role="alert"
            />
          ) : items.length === 0 ? (
            <StateCard
              icon={<PackageSearch className="size-8 text-gray-400" />}
              title="Chưa có nguyên liệu nào trong kho"
              description="Khi chi nhánh nhập nguyên liệu đầu tiên, danh sách sẽ xuất hiện tại đây."
            />
          ) : rows.length === 0 ? (
            <StateCard
              icon={<PackageSearch className="size-8 text-gray-400" />}
              title="Không tìm thấy nguyên liệu phù hợp"
              description={filtering ? 'Thử đổi từ khoá hoặc bỏ bộ lọc "Sắp hết".' : undefined}
              action={<Button variant="outline" onClick={clearFilters}>Xoá bộ lọc</Button>}
            />
          ) : (
            <StockTable items={rows} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </>
      )}

      {branchId !== null && selected && (
        <InventoryDrawer
          branchId={branchId}
          item={selected}
          onClose={() => {
            setAdjusting(false);
            setSelectedId(null);
          }}
          onAdjust={() => setAdjusting(true)}
        />
      )}
      {branchId !== null && selected && adjusting && <AdjustModal branchId={branchId} item={selected} onClose={() => setAdjusting(false)} />}

      {/* Chưa có Toaster toàn cục trong app; khi có thì bỏ dòng này. */}
      <Toaster richColors position="top-right" />
    </div>
  );
}

function StateCard({
  icon, title, description, action, role,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  role?: 'alert';
}) {
  return (
    <Card role={role} padding="lg" className="flex flex-col items-center gap-3 py-12 text-center">
      {icon}
      <h2 className="text-h4 text-gray-900">{title}</h2>
      {description && <p className="max-w-md text-body text-gray-600">{description}</p>}
      {action}
    </Card>
  );
}
