import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, CreditCard, QrCode, WifiOff, XCircle } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PATHS, to } from "@/app/routes";
import { isApiError, orderApi, paymentApi } from "@/shared/api";
import { formatVnd } from "@/shared/lib";
import type { PayResult, SimulatedPaymentResult } from "@/shared/types";
import { Button, Skeleton } from "@/shared/ui";
import { PageHeader } from "@/features/dine-in/components/PageHeader";
import { placedOrderMeta, usePlacedOrders } from "@/features/dine-in/placed-orders";
import { useDineInCartStore } from "@/features/dine-in/store";
import { PAYMENT_POLL_MS } from "../config";
import { formatCountdown, useRemainingMs } from "../countdown";
import { describePaymentError, gatewayPath } from "../hooks/useStartOnlinePayment";

const positiveInt = (raw: string | null | undefined): number | null => {
  const n = Number(raw);
  return raw != null && raw.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
};

function Shell({ title = "Cổng thanh toán", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-primary-50 pb-10">
      <PageHeader title={title} />
      <div className="space-y-4 px-4 pt-6 text-center">{children}</div>
    </div>
  );
}

function Notice({ icon, title, children, tone = "neutral", actions }: {
  icon: ReactNode; title: string; children?: ReactNode; tone?: "neutral" | "success" | "error"; actions?: ReactNode;
}) {
  const ring = { neutral: "bg-primary-100 text-primary-700", success: "bg-success-soft text-success-strong", error: "bg-error-soft text-error-strong" }[tone];
  return (
    <section className="space-y-3 rounded-xl border border-primary-100 bg-white p-6 shadow-card" role={tone === "error" ? "alert" : "status"}>
      <div className={`mx-auto grid size-14 place-items-center rounded-full ${ring}`} aria-hidden>{icon}</div>
      <h2 className="font-heading text-h3 text-gray-900">{title}</h2>
      {children && <div className="text-body text-gray-600">{children}</div>}
      {actions && <div className="flex flex-col gap-2 pt-2">{actions}</div>}
    </section>
  );
}

const linkBtn = "flex h-12 w-full items-center justify-center rounded-md bg-primary-600 font-medium text-white hover:bg-primary-700";

/**
 * Cổng thanh toán GIẢ LẬP (mock VNPay) của Dine-in. Trang chỉ HIỂN THỊ trạng thái giao dịch và polling mỗi 3 giây:
 * IPN (POST .../simulate ở mock) mới là nguồn sự thật. Khách guest vào được (không yêu cầu đăng nhập) nhờ mã phiên bàn
 * đã lưu cùng đơn. Không bao giờ tạo đơn mới; chỉ "Thử lại" mới tạo giao dịch mới cho cùng đơn.
 */
export default function PaymentGatewayPage({ pollMs = PAYMENT_POLL_MS }: { pollMs?: number }) {
  const { orderId: rawOrderId } = useParams<{ orderId: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const orderId = positiveInt(rawOrderId);
  const paymentId = positiveInt(search.get("paymentId"));
  const valid = orderId !== null && paymentId !== null;

  const placed = usePlacedOrders((s) => s.orders.find((o) => o.id === orderId));
  const meta = orderId === null ? {} : placedOrderMeta(orderId);
  const sessionCode = meta.sessionCode ?? null;
  const storeTableCode = useDineInCartStore((s) => s.tableCode);
  const tableCode = meta.tableCode ?? storeTableCode;

  const key = ["payment", "gateway", paymentId] as const;
  const payment = useQuery({
    queryKey: key,
    enabled: valid,
    retry: false,
    queryFn: ({ signal }) => paymentApi.getPayment(paymentId!, { sessionCode, signal }),
    // Dừng polling ngay khi giao dịch đã chốt; lỗi mạng giữa chừng vẫn giữ dữ liệu cũ và tiếp tục hỏi lại.
    refetchInterval: (q) => (q.state.data?.payment.status === "Pending" ? pollMs : false),
  });
  const data: PayResult | undefined = payment.data;

  // Mã đơn lấy từ đơn đã lưu lúc đặt; thiết bị khác thì thử đọc đơn (lỗi quyền/mạng → bỏ qua, hiện số đơn).
  const fetched = useQuery({
    queryKey: ["payment", "gateway-order", orderId],
    enabled: valid && !placed && !!data,
    retry: false,
    queryFn: () => orderApi.getOrder(orderId!),
  });
  const orderCode = placed?.orderCode ?? fetched.data?.orderCode ?? null;

  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const simulate = useMutation({
    mutationFn: (result: SimulatedPaymentResult) => paymentApi.simulatePayment(paymentId!, { result }, { sessionCode }),
    onMutate: () => setActionError(null),
    onSuccess: (res) => qc.setQueryData(key, res),
    onError: (e) => {
      setActionError(describePaymentError(e));
      void payment.refetch(); // trạng thái thật có thể đã khác (đã chốt ở nơi khác)
    },
  });

  const retry = useMutation({
    mutationFn: () =>
      paymentApi.payOrders(
        { orderIds: [orderId!], method: data?.payment.paymentMethod ?? "VNPay", idempotencyKey: `dinein-retry-${orderId}-${crypto.randomUUID()}` },
        { sessionCode },
      ),
    onMutate: () => setActionError(null),
    onSuccess: (res) => navigate(gatewayPath(orderId!, res.payment.id, res.redirectUrl), { replace: true }),
    onError: (e) => {
      if (isApiError(e) && e.is("ORDER_ALREADY_PAID")) setAlreadyPaid(true);
      else setActionError(describePaymentError(e));
    },
  });

  const status = data?.payment.status;
  const remaining = useRemainingMs(status === "Pending" ? data?.payment.expiresAt : null);

  // ── Địa chỉ không hợp lệ ────────────────────────────────────────────
  if (!valid) {
    return (
      <Shell>
        <Notice tone="error" icon={<AlertCircle className="size-7" />} title="Không tìm thấy giao dịch"
          actions={<Link to={PATHS.start} className={linkBtn}>Về trang bắt đầu</Link>}>
          Đường dẫn thanh toán thiếu mã đơn hoặc mã giao dịch. Nếu bạn vừa đặt món, hãy báo mã đơn cho nhân viên.
        </Notice>
      </Shell>
    );
  }

  if (payment.isPending) {
    return (
      <Shell>
        <div className="space-y-3" aria-busy aria-label="Đang tải giao dịch"><Skeleton className="h-24" /><Skeleton className="h-56" /></div>
      </Shell>
    );
  }

  // ── Không đọc được giao dịch (lần tải đầu) ──────────────────────────
  if (!data) {
    const err = payment.error;
    const offline = isApiError(err) && err.status === 0;
    return (
      <Shell>
        <Notice
          tone="error"
          icon={offline ? <WifiOff className="size-7" /> : <AlertCircle className="size-7" />}
          title={offline ? "Mất kết nối" : "Không mở được giao dịch"}
          actions={
            <>
              {offline && <Button size="lg" loading={payment.isFetching} onClick={() => void payment.refetch()}>Thử lại</Button>}
              {orderId !== null && <Link to={to.counterPayment(String(orderId))} className={offline ? "text-body font-medium text-primary-600 underline" : linkBtn}>Thanh toán tại quầy</Link>}
            </>
          }
        >
          {isApiError(err) && err.status === 404 ? "Không tìm thấy giao dịch hoặc đơn này." : describePaymentError(err)}
        </Notice>
      </Shell>
    );
  }

  // Giao dịch phải thuộc đúng đơn trên URL (chống ghép sai orderId/paymentId).
  if (!data.allocations.some((a) => a.orderId === orderId)) {
    return (
      <Shell>
        <Notice tone="error" icon={<AlertCircle className="size-7" />} title="Giao dịch không thuộc đơn này"
          actions={<Link to={PATHS.start} className={linkBtn}>Về trang bắt đầu</Link>}>
          Vui lòng quét lại mã QR trên bàn hoặc báo nhân viên.
        </Notice>
      </Shell>
    );
  }

  const label = orderCode ? `#${orderCode}` : `Đơn #${orderId}`;
  const amount = formatVnd(data.payment.amount);
  const toMenu = tableCode ? to.dineInTable(tableCode) : PATHS.start;
  const toCounter = (
    <Link to={to.counterPayment(String(orderId))} className="flex h-12 w-full items-center justify-center rounded-md border border-gray-300 bg-white font-medium text-gray-800 hover:bg-gray-50">
      Chuyển sang trả tại quầy
    </Link>
  );

  // ── Thành công ─────────────────────────────────────────────────────
  if (status === "Success") {
    return (
      <Shell title="Thanh toán thành công">
        <Notice tone="success" icon={<CheckCircle2 className="size-8" />} title="Thanh toán thành công"
          actions={<Link to={toMenu} className={linkBtn}>{tableCode ? "Về thực đơn bàn" : "Về trang bắt đầu"}</Link>}>
          <p className="font-heading text-h2 text-primary-600">{amount}</p>
          <p className="mt-1">Đơn <strong>{label}</strong> đã được ghi nhận thanh toán online. Quầy sẽ nhận được thông báo.</p>
          {data.payment.transactionId && <p className="mt-2 text-caption text-gray-500">Mã giao dịch: {data.payment.transactionId}</p>}
        </Notice>
      </Shell>
    );
  }

  // ── Đơn đã được thanh toán (không cho thanh toán lại) ────────────────
  if (status === "Cancelled" || alreadyPaid) {
    return (
      <Shell>
        <Notice tone="success" icon={<CheckCircle2 className="size-8" />} title="Đơn này đã được thanh toán"
          actions={<Link to={toMenu} className={linkBtn}>{tableCode ? "Về thực đơn bàn" : "Về trang bắt đầu"}</Link>}>
          Đơn <strong>{label}</strong> đã được thanh toán nên không thể thanh toán lại.
        </Notice>
      </Shell>
    );
  }

  // ── Thất bại / hết hạn ──────────────────────────────────────────────
  if (status === "Failed" || status === "Expired") {
    return (
      <Shell>
        <Notice tone="error" icon={<XCircle className="size-8" />} title={status === "Expired" ? "Giao dịch đã hết hạn" : "Thanh toán thất bại"}
          actions={
            <>
              <Button size="lg" loading={retry.isPending} leftIcon={<CreditCard className="size-5" aria-hidden />} onClick={() => retry.mutate()}>Thử lại</Button>
              {toCounter}
            </>
          }>
          <p>Đơn <strong>{label}</strong> chưa được thanh toán và không bị trừ tiền ({amount}).</p>
          {actionError && <p className="mt-2 font-medium text-error-strong">{actionError}</p>}
        </Notice>
      </Shell>
    );
  }

  // ── Đang chờ thanh toán ─────────────────────────────────────────────
  const lostConnection = payment.isError;
  return (
    <Shell>
      <p className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-3 py-1 text-caption font-medium text-warning-strong">
        Môi trường giả lập — không phát sinh giao dịch thật
      </p>

      <section aria-label="Thông tin thanh toán" className="rounded-xl border border-primary-100 bg-white p-6 shadow-card">
        <p className="text-body text-gray-600">Đơn <strong className="text-gray-900">{label}</strong></p>
        <p className="mt-1 font-heading text-h1 text-primary-600">{amount}</p>
        <div className="mx-auto mt-4 grid size-28 place-items-center rounded-lg border border-dashed border-primary-200 text-primary-400" aria-hidden>
          <QrCode className="size-16" />
        </div>
        <p className="mt-3 inline-flex items-center gap-1.5 text-body font-medium text-gray-800">
          <Clock className="size-4 text-primary-600" aria-hidden />
          {remaining === null ? "Đang chờ thanh toán" : remaining > 0 ? <>Còn lại <span aria-label="thời gian còn lại">{formatCountdown(remaining)}</span></> : "Đang xác nhận hết hạn…"}
        </p>
        <p className="mt-1 text-caption text-gray-500">Đang chờ kết quả từ cổng {data.payment.paymentMethod}…</p>
      </section>

      {lostConnection && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-left text-body text-warning-strong">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>Mất kết nối, đang thử lại… Giao dịch của bạn vẫn được giữ nguyên.</p>
        </div>
      )}

      <section aria-label="Giả lập kết quả" className="space-y-2 rounded-xl border border-primary-100 bg-white p-4 text-left">
        <h3 className="text-body font-semibold text-gray-900">Giả lập kết quả từ cổng thanh toán</h3>
        <div className="grid gap-2">
          <Button size="lg" loading={simulate.isPending && simulate.variables === "success"} disabled={simulate.isPending} onClick={() => simulate.mutate("success")}>
            Thanh toán thành công
          </Button>
          <Button size="lg" variant="outline" loading={simulate.isPending && simulate.variables === "failed"} disabled={simulate.isPending} onClick={() => simulate.mutate("failed")}>
            Thanh toán thất bại
          </Button>
          <Button size="lg" variant="outline" loading={simulate.isPending && simulate.variables === "expired"} disabled={simulate.isPending} onClick={() => simulate.mutate("expired")}>
            Hết hạn
          </Button>
        </div>
        {actionError && <p role="alert" className="text-body font-medium text-error-strong">{actionError}</p>}
      </section>

      {toCounter}
    </Shell>
  );
}
