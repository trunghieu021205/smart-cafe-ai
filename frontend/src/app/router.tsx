import { lazy, Suspense } from "react";
import { createBrowserRouter, Link, type RouteObject } from "react-router-dom";
import { RequireRole } from "@/app/guards/RequireRole";
import { CustomerLayout } from "@/app/layouts/CustomerLayout";
import { StaffShellLayout } from "@/app/layouts/StaffShellLayout";
import { PATHS } from "@/app/routes";
import LoginPage from "@/features/auth/pages/LoginPage";
import RegisterPage from "@/features/auth/pages/RegisterPage";
import VerifyOtpPage from "@/features/auth/pages/VerifyOtpPage";
import ForgotPasswordPage from "@/features/auth/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/features/auth/pages/ResetPasswordPage";
import DineInTablePage from "@/features/dine-in/pages/DineInTablePage";
import DineInCheckoutPage from "@/features/dine-in/pages/DineInCheckoutPage";
import CounterPaymentPage from "@/features/dine-in/pages/CounterPaymentPage";
import PaymentGatewayPage from "@/features/payment/pages/PaymentGatewayPage";
import HomePage from "@/features/home/pages/HomePage";
import MenuBrowsePage from "@/features/home/pages/MenuBrowsePage";
import OrderModePage from "@/features/home/pages/OrderModePage";
import OrderDetailPage from "@/features/order-queue/pages/OrderDetailPage";
import OrderQueuePage from "@/features/order-queue/pages/OrderQueuePage";
import CartPage from "@/features/online-order/pages/CartPage";
import OnlineCheckoutPage from "@/features/online-order/pages/OnlineCheckoutPage";
import OrderSuccessPage from "@/features/online-order/pages/OrderSuccessPage";
import OrderHistoryPage from '@/features/orders/pages/OrderHistoryPage';
import OrderTrackingPage from "@/features/online-order/pages/OrderTrackingPage";
import StaffDashboardPage from "@/features/staff-dashboard/pages/StaffDashboardPage";
import PlaceholderPage from "@/pages/PlaceholderPage";

const P = PlaceholderPage;

// Tải lười để trang này không đi vào bundle production
const DesignSystemPage = lazy(() => import("@/pages/DesignSystemPage"));

function NotFound() {
  return (
    <div className="p-6">
      <h1 className="text-h2">Không tìm thấy trang</h1>
      <Link to="/" className="text-primary-600 underline">
        Về trang chủ
      </Link>
    </div>
  );
}

// Trang xem design system: chỉ tồn tại khi chạy dev
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: "/design-system",
        element: (
          <Suspense fallback={null}>
            <DesignSystemPage />
          </Suspense>
        ),
      },
    ]
  : [];

/** Tách ra khỏi createBrowserRouter để test dựng router bộ nhớ từ đúng cấu hình thật. */
export const routes: RouteObject[] = [
  // ── Auth (spec #1–5, CORE) ──────────────────────────────────────────
  { path: PATHS.login, element: <LoginPage /> },
  {
    path: PATHS.register,
    element: <RegisterPage />,
  },
  { path: PATHS.verifyOtp, element: <VerifyOtpPage /> },
  { path: PATHS.forgotPassword, element: <ForgotPasswordPage /> },
  { path: PATHS.resetPassword, element: <ResetPasswordPage /> },
  ...devRoutes,

  // ── Công khai, khung riêng (không bottom-nav) ───────────────────────
  { path: PATHS.start, element: <OrderModePage /> },

  // ── Dine-in: trang QR Ordering có khung riêng (sticky bar giỏ hàng, không bottom-nav) ──
  { path: PATHS.dineInTable, element: <DineInTablePage /> },
  // Màn xác nhận sau khi đặt: chỉ đọc đơn đã lưu, không bao giờ gửi lại đơn khi F5
  { path: PATHS.counterPayment, element: <CounterPaymentPage /> },
  // Cổng thanh toán giả lập (VNPay mock): công khai để khách guest quét QR bàn thanh toán được; khung riêng, không bottom-nav.
  { path: PATHS.payment, element: <PaymentGatewayPage /> },

  // ── Khách ───────────────────────────────────────────────────────────
  // Dine-in và duyệt menu: không cần đăng nhập (quét QR tại bàn vẫn đặt món được).
  // Online checkout, đơn hàng, hồ sơ: cần đăng nhập.
  {
    element: <CustomerLayout />,
    children: [
      { path: PATHS.home, element: <HomePage /> },
      { path: PATHS.menu, element: <MenuBrowsePage /> },
      { path: PATHS.product, element: <P title="Chi tiết sản phẩm" /> },
      { path: PATHS.cart, element: <CartPage /> },

      // Dine-in
      { path: PATHS.dineInCheckout, element: <DineInCheckoutPage /> },

      // Cần đăng nhập
      {
        element: <RequireRole allow={["Customer"]} />,
        children: [
          { path: PATHS.checkout, element: <OnlineCheckoutPage /> },
          // Màn thành công của đơn Online (đọc đơn đã tạo, không bao giờ POST)
          { path: PATHS.paymentSuccess, element: <OrderSuccessPage /> },
          { path: PATHS.orders, element: <OrderHistoryPage /> },
          { path: PATHS.order, element: <OrderTrackingPage /> },
          { path: PATHS.profile, element: <P title="Hồ sơ & địa chỉ" /> },
        ],
      },
    ],
  },

  // ── Nhân viên / Quản lý / Quản trị ──────────────────────────────────
  // Guard nằm NGOÀI shell để người chưa đăng nhập không thấy khung sidebar trước khi bị chuyển hướng.
  {
    element: <RequireRole allow={["Staff"]} />,
    children: [
      {
        element: <StaffShellLayout />,
        children: [
          {
            path: PATHS.staff,
            element: <StaffDashboardPage />,
          },
          { path: PATHS.staffQueue, element: <OrderQueuePage /> },
          { path: PATHS.staffOrder, element: <OrderDetailPage /> },
          { path: PATHS.staffCheckin, element: <P title="Check-in QR" /> },
        ],
      },
    ],
  },
  {
    element: <RequireRole allow={["Manager"]} />,
    children: [
      {
        element: <StaffShellLayout />,
        children: [
          { path: PATHS.manager, element: <P title="Manager Dashboard" /> },
          { path: PATHS.managerInventory, element: <P title="Kho" /> },
          { path: PATHS.managerForecast, element: <P title="Dự báo AI" /> },
        ],
      },
    ],
  },
  {
    element: <RequireRole allow={["Admin"]} />,
    children: [
      {
        element: <StaffShellLayout />,
        children: [
          { path: PATHS.admin, element: <P title="Admin Dashboard" /> },
          { path: PATHS.adminUsers, element: <P title="Quản lý người dùng" /> },
          {
            path: PATHS.adminTables,
            element: <P title="Bàn & QR" note="Có nút Tạo QR ca hôm nay" />,
          },
        ],
      },
    ],
  },

  { path: "*", element: <NotFound /> },
];

export const router = createBrowserRouter(routes);
