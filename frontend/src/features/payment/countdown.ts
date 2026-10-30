import { useEffect, useState } from 'react';

/** Thời gian còn lại (ms, ≥ 0) tới `expiresAt`; cập nhật mỗi giây. null khi chưa có mốc hết hạn. */
export function useRemainingMs(expiresAt: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const end = Date.parse(expiresAt);
  return Number.isFinite(end) ? Math.max(0, end - now) : null;
}

/** 899_000 → "14:59". */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
