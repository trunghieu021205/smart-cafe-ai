import { Badge, type BadgeTone } from '@/shared/ui';
import { STOCK_STATUS_LABEL, type StockStatus } from '../model';

const TONE: Record<StockStatus, BadgeTone> = { out: 'error', low: 'warning', ok: 'success' };

export function StockStatusBadge({ status }: { status: StockStatus }) {
  return <Badge tone={TONE[status]}>{STOCK_STATUS_LABEL[status]}</Badge>;
}
