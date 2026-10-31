
// ── Common ────────────────────────────────────────────────────────────
export type IsoDateTime = string;
export type IsoDate = string; // YYYY-MM-DD
export type TimeOfDay = string; // HH:mm:ss

export interface Page<T> {
  items: T[];
  total: number;
  page: number; // bắt đầu từ 1
  pageSize: number;
}

export interface PageParams {
  page?: number;
  pageSize?: number;
}

export interface ApiErrorBody {
  message: string;
  code?: string; // ví dụ: VERSION_CONFLICT, INVALID_TRANSITION, OPTION_REQUIRED
}

// ══════════════════════════════════════════════════════════════════════
// 01. Identity
// ══════════════════════════════════════════════════════════════════════
export type UserStatus = 'Unverified' | 'Active' | 'Banned' | 'Deactivated';
/** Role.name trong DB là chuỗi tự do; FE chỉ làm việc với 4 persona của spec. */
export type RoleName = 'Customer' | 'Staff' | 'Manager' | 'Admin';

export interface Role {
  id: number;
  name: string;
  description?: string | null;
}

export interface User {
  id: string; // VARCHAR(36) UUID
  email?: string | null;
  phone?: string | null;
  fullName: string;
  avatar?: string | null;
  roleId: number;
  status: UserStatus;
  emailVerifiedAt?: IsoDateTime | null;
  phoneVerifiedAt?: IsoDateTime | null;
  lastLoginAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Address {
  id: number;
  userId: string;
  label?: string | null;
  receiverName: string;
  phone: string;
  province: string;
  /** Legacy – VN bỏ cấp quận/huyện từ 2025-07-01 */
  district?: string | null;
  ward: string;
  addressLine: string;
  latitude?: number | null;
  longitude?: number | null;
  isDefault: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface LoginInput {
  /** email hoặc số điện thoại */
  identifier: string;
  password: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken?: string | null;
  user: User;
  roleName: RoleName;
  /** Branch scope của nhân viên – nằm trong token claims (Store Service sở hữu) */
  branchId?: number | null;
}

// ══════════════════════════════════════════════════════════════════════
// 02. Catalog
// ══════════════════════════════════════════════════════════════════════
export type ProductStatus = 'Active' | 'Inactive';
export type Temperature = 'Hot' | 'Iced' | 'Blended' | 'Hot_Or_Iced';
export type CaffeineLevel = 'None' | 'Low' | 'Medium' | 'High';
export type SelectionType = 'Single' | 'Multiple';

export interface Category {
  id: number;
  name: string;
  image?: string | null;
  sortOrder: number;
  status: ProductStatus;
}

export interface Product {
  id: number;
  categoryId: number;
  name: string;
  image?: string | null;
  description?: string | null;
  /** NULL với món không phải đồ uống (bánh, merchandise) */
  temperature?: Temperature | null;
  caffeineLevel: CaffeineLevel;
  flavorTags?: string[] | null; // JSON array, lowercase
  sortOrder: number;
  status: ProductStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProductVariant {
  id: number;
  productId: number;
  variantName: string; // mặc định 'Standard'
  price: number; // VND
  sortOrder: number;
  status: ProductStatus;
}

export interface VariantPriceHistory {
  id: number;
  variantId: number;
  oldPrice?: number | null;
  newPrice: number;
  changedBy?: string | null;
  changedAt: IsoDateTime;
}

export interface ProductOptionGroup {
  id: number;
  productId: number;
  name: string;
  selectionType: SelectionType;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
}

export interface ProductOption {
  id: number;
  groupId: number;
  optionName: string;
  extraPrice: number; // VND
  isDefault: boolean;
  sortOrder: number;
  status: ProductStatus;
}

/**
 * Availability: "không có row" = CÒN HÀNG.
 * Sellable ⇔ product Active ∧ variant Active ∧ (no row ∨ isAvailable).
 */
export interface BranchProductAvailability {
  id: number;
  branchId: number;
  variantId: number;
  isAvailable: boolean;
  unavailableReason?: string | null;
  updatedAt: IsoDateTime;
}

export interface BranchOptionAvailability {
  id: number;
  branchId: number;
  optionId: number;
  isAvailable: boolean;
  unavailableReason?: string | null;
  updatedAt: IsoDateTime;
}

/**
 * View v_products_full. `price`/`maxPrice` là NULL khi sản phẩm không còn
 * variant Active (LEFT JOIN) → UI phải xử lý.
 */
export interface ProductFull {
  id: number;
  categoryId: number;
  name: string;
  image?: string | null;
  description?: string | null;
  temperature?: Temperature | null;
  caffeineLevel: CaffeineLevel;
  flavorTags?: string[] | null;
  status: ProductStatus;
  sortOrder: number;
  price: number | null; // MIN active variant
  maxPrice: number | null; // MAX active variant
}

// ── Catalog view models ───────────────────────────────────────────────
/** Dòng menu theo chi nhánh: ProductFull + khả dụng tại chi nhánh. */
export interface MenuProduct extends ProductFull {
  /** true nếu còn ít nhất 1 variant bán được tại chi nhánh */
  isAvailable: boolean;
}

export interface ProductVariantView extends ProductVariant {
  isAvailable: boolean;
  unavailableReason?: string | null;
}

export interface ProductOptionView extends ProductOption {
  isAvailable: boolean;
  unavailableReason?: string | null;
}

export interface ProductOptionGroupView extends ProductOptionGroup {
  options: ProductOptionView[];
}

export interface ProductDetail extends Product {
  variants: ProductVariantView[];
  optionGroups: ProductOptionGroupView[];
}

export interface ListProductsParams {
  branchId: number;
  categoryId?: number;
  /** tìm theo tên */
  q?: string;
  /** flavor tag: WHERE 'creamy' MEMBER OF (flavor_tags) */
  flavor?: string;
  temperature?: Temperature;
  caffeineLevel?: CaffeineLevel;
  /** mặc định false: ẩn món hết hàng; true: trả cả món hết hàng (isAvailable=false) */
  includeUnavailable?: boolean;
}

// ══════════════════════════════════════════════════════════════════════
// 03. Store (+ Workforce)
// ══════════════════════════════════════════════════════════════════════
export type BranchStatus = 'Active' | 'Inactive';
export type TableSessionStatus = 'Active' | 'Payment_Pending' | 'Completed' | 'Cancelled';
export type StaffStatus = 'Active' | 'On_Leave' | 'Inactive' | 'Terminated';
export type EmploymentType = 'Full_Time' | 'Part_Time' | 'Probation' | 'Intern';
export type ScheduleStatus = 'Scheduled' | 'Completed' | 'Absent' | 'Leave';
export type LeaveType = 'Annual' | 'Sick' | 'Unpaid' | 'Other';
export type LeaveRequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
export type TimekeepingSource = 'Manual' | 'Device' | 'GPS' | 'QR';

export interface Branch {
  id: number;
  code: string;
  name: string;
  address: string;
  phone?: string | null;
  /**
   * CHỜ CHỐT: trong SQL, 2 cột latitude/longitude đang bị comment bằng `--latitude`
   * (thiếu dấu cách nên là lỗi cú pháp). Nếu bật lại thì hai field này có dữ liệu,
   * nếu bỏ thì xoá khỏi type.
   */
  latitude?: number | null;
  longitude?: number | null;
  timezone: string; // default 'Asia/Ho_Chi_Minh'
  openingTime?: TimeOfDay | null;
  closingTime?: TimeOfDay | null;
  acceptsOnlineOrders: boolean;
  deliveryRadiusKm?: number | null; // null = không giao hàng
  deliveryFee: number; // VND
  status: BranchStatus;
}

export interface Table {
  id: number;
  branchId: number;
  tableNumber: string; // ví dụ "05"
  qrCode?: string | null;
  isActive: boolean;
}

/** Derived từ v_table_status */
export type TableStatus = 'Empty' | 'Occupied';

export interface TableStatusView {
  tableId: number;
  branchId: number;
  tableNumber: string;
  isActive: boolean;
  status: TableStatus;
  openSessionId?: number | null;
}

export interface TableSession {
  id: number;
  tableId: number;
  sessionCode: string; // random unguessable token
  customerId?: string | null; // Identity Users.id; khách QR ẩn danh có thể null
  status: TableSessionStatus;
  openedAt: IsoDateTime;
  expiresAt?: IsoDateTime | null;
  closedAt?: IsoDateTime | null;
}

export interface StaffProfile {
  id: number;
  userId: string;
  branchId: number;
  employeeCode: string;
  jobTitle: string; // Barista, Cashier, Shift Leader, Store Manager...
  employmentType: EmploymentType;
  hireDate: IsoDate;
  terminationDate?: IsoDate | null;
  status: StaffStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface StaffBranchHistory {
  id: number;
  staffId: number;
  fromBranchId?: number | null;
  toBranchId: number;
  effectiveDate: IsoDate;
  changedBy?: string | null;
  note?: string | null;
  createdAt: IsoDateTime;
}

export interface Shift {
  id: number;
  branchId: number;
  name: string;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  /** true khi ca kết thúc sang ngày hôm sau (generated column) */
  isOvernight: boolean;
  isActive: boolean;
}

export interface Schedule {
  id: number;
  branchId: number;
  staffId: number;
  shiftId: number;
  workDate: IsoDate;
  status: ScheduleStatus;
}

export interface Timekeeping {
  id: number;
  scheduleId: number;
  checkIn?: IsoDateTime | null;
  checkOut?: IsoDateTime | null;
  source: TimekeepingSource;
  isAdjusted: boolean;
  adjustedByStaffId?: number | null;
  adjustmentReason?: string | null;
}

export interface LeaveRequest {
  id: number;
  staffId: number;
  leaveType: LeaveType;
  startDate: IsoDate;
  endDate: IsoDate;
  reason: string;
  status: LeaveRequestStatus;
  approverStaffId?: number | null;
  reviewedAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

// ── Store view models / inputs ────────────────────────────────────────
export interface ScheduleView extends Schedule {
  shift: Shift;
  staffName: string;
  employeeCode: string;
  jobTitle: string;
  timekeeping?: Timekeeping | null;
}

export interface ListSchedulesParams {
  branchId?: number;
  staffId?: number;
  from?: IsoDate;
  to?: IsoDate;
}

/** Check-in/out bằng QR tĩnh theo ca (spec v3). Token dạng `shift-qr:<shiftId>`. */
export interface TimekeepingScanInput {
  qrToken: string;
}

export interface OpenTableSessionInput {
  /** Giá trị Tables.qr_code mà khách quét được */
  qrCode: string;
  customerId?: string;
}

/** Hoá đơn tạm của cả bàn (gom mọi đơn chưa huỷ trong session). */
export interface TableBill {
  session: TableSession;
  tableNumber: string;
  branchId: number;
  orders: OrderDetail[];
  subTotal: number;
  discountTotal: number; // item + voucher
  finalAmount: number;
  paidAmount: number;
  remainingAmount: number;
}

// ══════════════════════════════════════════════════════════════════════
// 04. Order
// ══════════════════════════════════════════════════════════════════════
/**
 * - order_source: Online | QR | POS
 * - fulfillment_type: Delivery | Pickup | Dine_In
 * Tổ hợp hợp lệ (CHECK trong DB):
 *   QR     → Dine_In
 *   POS    → Dine_In | Pickup
 *   Online → Delivery | Pickup
 */
export type OrderSource = 'Online' | 'QR' | 'POS';
export type FulfillmentType = 'Delivery' | 'Pickup' | 'Dine_In';

export type OrderStatus =
  | 'Pending_Payment'
  | 'Pending'
  | 'Confirmed'
  | 'Preparing'
  | 'Ready'
  | 'Shipping' // chỉ Delivery
  | 'Served' // chỉ Dine_In
  | 'Completed'
  | 'Cancelled'
  | 'Rejected';

export type PaymentStatus = 'Unpaid' | 'Paid' | 'Partially_Refunded' | 'Refunded';

export interface Order {
  id: number;
  orderCode: string; // UNIQUE, hiển thị (không có #)
  idempotencyKey?: string | null;
  userId?: string | null; // bắt buộc khi Online
  createdBy?: string | null; // staff user_id, bắt buộc khi POS
  branchId: number;
  tableSessionId?: number | null; // bắt buộc khi Dine_In
  orderSource: OrderSource;
  fulfillmentType: FulfillmentType;

  // Delivery snapshot (bắt buộc khi Delivery)
  deliveryName?: string | null;
  deliveryPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;

  // Money (VAT-inclusive)
  subTotal: number; // tổng gross các dòng (món + option), trước giảm giá
  itemDiscountAmount: number;
  voucherCode?: string | null;
  voucherDiscountAmount: number;
  deliveryFee: number;
  vatAmount: number; // phần VAT đã nằm trong finalAmount
  finalAmount: number; // = subTotal - itemDiscount - voucherDiscount + deliveryFee

  status: OrderStatus;
  paymentStatus: PaymentStatus;
  expiresAt?: IsoDateTime | null; // Pending_Payment
  cancelReason?: string | null; // bắt buộc khi Cancelled/Rejected
  cancelledBy?: string | null;
  cancelledAt?: IsoDateTime | null;
  completedAt?: IsoDateTime | null;
  note?: string | null;
  version: number; // optimistic lock
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface OrderItem {
  id: number;
  orderId: number;
  productId: number; // Catalog external
  variantId: number; // Catalog external
  productName: string; // snapshot
  variantName: string; // snapshot
  quantity: number;
  unitPrice: number; // snapshot variant price
  optionsUnitTotal: number; // snapshot tổng option / 1 unit
  discountAmount: number;
  isRewardItem: boolean; // free drink từ loyalty (tối đa 1/đơn, chỉ giảm giá base)
  lineTotal: number; // generated: qty * (unitPrice + optionsUnitTotal) - discount
  note?: string | null;
}

export interface OrderItemOption {
  id: number;
  orderItemId: number;
  optionId: number; // Catalog external
  optionName: string; // snapshot
  quantity: number; // trên MỖI 1 unit của item
  unitPrice: number; // snapshot
}

export interface OrderStatusHistory {
  id: number;
  orderId: number;
  fromStatus?: string | null;
  status: OrderStatus;
  changedBy?: string | null; // null = hệ thống
  note?: string | null;
  createdAt: IsoDateTime;
}

// ── Order view models ─────────────────────────────────────────────────
export interface OrderItemDetail extends OrderItem {
  options: OrderItemOption[];
}

export interface OrderDetail extends Order {
  /** join từ Store (chỉ Dine_In) */
  tableNumber?: string | null;
  /**
   * MỞ RỘNG CỦA MOCK/FE (spec Order không có field này): đơn đã được thanh toán qua cổng online (VNPay/Momo).
   * Order không lưu phương thức thanh toán nên tab Thu ngân dùng cờ này để nhận ra đơn Dine-in trả online.
   */
  paidOnline?: boolean;
  items: OrderItemDetail[];
  statusHistory: OrderStatusHistory[];
}

// ── Cart ──────────────────────────────────────────────────────────────
export type CartSource = 'Online' | 'QR';
export type CartStatus = 'Active' | 'Converted' | 'Abandoned';

export interface Cart {
  id: number;
  cartSource: CartSource;
  branchId: number;
  fulfillmentType: FulfillmentType;
  userId?: string | null; // bắt buộc Online
  tableSessionId?: number | null; // bắt buộc QR
  clientKey?: string | null; // bắt buộc QR (thiết bị ẩn danh)
  status: CartStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CartItem {
  id: number;
  cartId: number;
  variantId: number;
  quantity: number;
  note?: string | null;
}

export interface CartItemOption {
  id: number;
  cartItemId: number;
  optionId: number;
  quantity: number;
}

export interface CartLineOptionView {
  optionId: number;
  optionName: string;
  quantity: number;
  unitPrice: number;
  isAvailable: boolean;
}

export interface CartLineView {
  item: CartItem;
  productId: number;
  productName: string;
  productImage?: string | null;
  variantName: string;
  unitPrice: number;
  options: CartLineOptionView[];
  optionsUnitTotal: number;
  lineTotal: number;
  /** false nếu món/option vừa hết hàng → UI chặn checkout */
  isAvailable: boolean;
}

export interface CartView {
  cart: Cart;
  lines: CartLineView[];
  itemCount: number; // tổng quantity
  subTotal: number;
  deliveryFee: number; // chỉ > 0 khi Delivery
}

/** Lấy (hoặc tạo) giỏ Active. Online dùng userId; QR dùng tableSessionId + clientKey. */
export type GetCartInput =
  | { cartSource: 'Online'; branchId: number; fulfillmentType: 'Delivery' | 'Pickup'; userId: string }
  | { cartSource: 'QR'; branchId: number; tableSessionId: number; clientKey: string };

export interface CartLineInput {
  variantId: number;
  quantity: number;
  options?: { optionId: number; quantity?: number }[];
  note?: string;
}

export interface UpdateCartItemInput {
  quantity?: number;
  note?: string | null;
}

// ── Order inputs ──────────────────────────────────────────────────────
export interface OrderLineInput {
  variantId: number;
  quantity: number;
  options?: { optionId: number; quantity?: number }[];
  note?: string;
  isRewardItem?: boolean; // free drink (cần ≥ 10 stamps, quantity = 1)
}

/** Online: 'online' → Pending_Payment (VNPay/Momo); 'counter' → Pending (COD hoặc trả tại quầy). */
export type PayAt = 'online' | 'counter';

interface CreateOrderCommon {
  branchId: number;
  lines: OrderLineInput[];
  voucherCode?: string;
  note?: string;
  /** Nếu đơn tạo từ giỏ, server chuyển giỏ sang Converted */
  cartId?: number;
  idempotencyKey?: string;
}

export interface DeliveryInfoInput {
  deliveryName: string;
  deliveryPhone: string;
  deliveryAddress: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
}

/** Khách quét QR tại bàn. userId có nếu khách đã đăng nhập (để tích tem). */
export interface CreateQrDineInOrderInput extends CreateOrderCommon {
  orderSource: 'QR';
  fulfillmentType: 'Dine_In';
  tableSessionId: number;
  userId?: string;
}

export interface CreatePosDineInOrderInput extends CreateOrderCommon {
  orderSource: 'POS';
  fulfillmentType: 'Dine_In';
  createdBy: string;
  tableSessionId: number;
  userId?: string;
}

export interface CreatePosPickupOrderInput extends CreateOrderCommon {
  orderSource: 'POS';
  fulfillmentType: 'Pickup';
  createdBy: string;
  userId?: string;
}

export interface CreateOnlinePickupOrderInput extends CreateOrderCommon {
  orderSource: 'Online';
  fulfillmentType: 'Pickup';
  userId: string;
  payAt?: PayAt;
}

export interface CreateOnlineDeliveryOrderInput extends CreateOrderCommon, DeliveryInfoInput {
  orderSource: 'Online';
  fulfillmentType: 'Delivery';
  userId: string;
  payAt?: PayAt;
}

/** Discriminated union: sai tổ hợp source/fulfillment sẽ lỗi ngay lúc compile. */
export type CreateOrderInput =
  | CreateQrDineInOrderInput
  | CreatePosDineInOrderInput
  | CreatePosPickupOrderInput
  | CreateOnlinePickupOrderInput
  | CreateOnlineDeliveryOrderInput;

export interface ChangeOrderStatusInput {
  to: OrderStatus;
  /** Optimistic lock – phải khớp Order.version hiện tại, lệch → 409 VERSION_CONFLICT */
  version: number;
  /** Bắt buộc khi to = Cancelled | Rejected */
  note?: string;
}

export interface ListOrdersParams extends PageParams {
  branchId?: number;
  orderSource?: OrderSource | OrderSource[];
  fulfillmentType?: FulfillmentType | FulfillmentType[];
  status?: OrderStatus | OrderStatus[];
  paymentStatus?: PaymentStatus | PaymentStatus[];
  userId?: string;
  tableSessionId?: number;
  /** Tìm theo orderCode hoặc tableNumber */
  q?: string;
  /** feed = đơn đang mở (chưa Completed/Cancelled/Rejected) | history = đã kết thúc */
  cashier?: 'feed' | 'history';
  from?: IsoDateTime;
  to?: IsoDateTime;
}

// ══════════════════════════════════════════════════════════════════════
// 05. Payment
// ══════════════════════════════════════════════════════════════════════
export type PaymentMethod = 'Cash' | 'COD' | 'VNPay' | 'Momo';
export type PaymentGatewayStatus = 'Pending' | 'Success' | 'Failed' | 'Cancelled' | 'Expired';
export type RefundStatus = 'Pending' | 'Approved' | 'Rejected' | 'Processed' | 'Failed';
export type RefundMethod = 'Cash' | 'VNPay' | 'Momo';
export type CashierShiftStatus = 'Open' | 'Closed';
/** Cash_In & COD_Remittance tăng két; Cash_Out & Safe_Drop giảm két */
export type CashMovementType = 'Cash_In' | 'Cash_Out' | 'Safe_Drop' | 'COD_Remittance';
export type InvoiceStatus = 'Requested' | 'Issued' | 'Cancelled' | 'Replaced' | 'Adjusted';
export type InvoiceRelationType = 'Replace' | 'Adjust';

export interface CashierShift {
  id: number;
  branchId: number;
  registerCode: string; // default 'MAIN'
  staffUserId: string;
  openingTime: IsoDateTime;
  closingTime?: IsoDateTime | null;
  openingCash: number;
  // Tổng được tính & đóng băng khi đóng ca (khi ca Open: server tính live)
  totalOrders: number;
  totalCashSales: number;
  totalOnlineSales: number;
  totalCashRefunds: number;
  totalCashIn: number;
  totalCashOut: number;
  expectedCash?: number | null; // opening + cashSales - cashRefunds + in - out
  closingCash?: number | null;
  /** closingCash - expectedCash (generated) */
  discrepancy?: number | null;
  status: CashierShiftStatus;
}

export interface CashMovement {
  id: number;
  cashierShiftId: number;
  movementType: CashMovementType;
  amount: number;
  reason: string;
  createdBy: string;
  createdAt: IsoDateTime;
}

export interface Payment {
  id: number;
  branchId: number;
  cashierShiftId?: number | null;
  idempotencyKey?: string | null;
  paymentMethod: PaymentMethod;
  amount: number;
  refundedAmount: number;
  cashReceived?: number | null;
  changeAmount?: number | null;
  collectedBy?: string | null; // shipper/staff COD
  transactionId?: string | null; // gateway
  status: PaymentGatewayStatus;
  expiresAt?: IsoDateTime | null;
  paidAt?: IsoDateTime | null;
  createdBy?: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PaymentOrderAllocation {
  id: number;
  paymentId: number;
  orderId: number; // Order external
  allocatedAmount: number;
  createdAt: IsoDateTime;
}

export interface Refund {
  id: number;
  paymentId: number;
  refundMethod: RefundMethod;
  cashierShiftId?: number | null; // bắt buộc khi Cash + Processed
  amount: number;
  reason: string;
  status: RefundStatus;
  requestedBy: string;
  approvedBy?: string | null;
  processedBy?: string | null;
  processedAt?: IsoDateTime | null;
  refundTransactionId?: string | null;
  createdAt: IsoDateTime;
}

export interface RefundOrderAllocation {
  id: number;
  refundId: number;
  orderId: number;
  amount: number;
  /** true chỉ khi món chưa pha: Inventory hoàn nguyên liệu */
  restockInventory: boolean;
  /** Engagement đảo tem đã tích của đơn này */
  reverseLoyalty: boolean;
}

export interface Invoice {
  id: number;
  invoiceNumber?: string | null;
  symbol?: string | null;
  templateCode?: string | null;
  buyerName: string;
  buyerTaxCode?: string | null;
  buyerAddress?: string | null;
  email?: string | null;
  subtotalAmount: number; // trước VAT
  vatRate: number; // %, default 8.00
  vatAmount: number;
  totalAmount: number; // = subtotalAmount + vatAmount
  lookupCode?: string | null;
  pdfUrl?: string | null;
  status: InvoiceStatus;
  relatedInvoiceId?: number | null;
  relationType?: InvoiceRelationType | null;
  issuedAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface InvoiceItem {
  id: number;
  invoiceId: number;
  lineNo: number;
  description: string;
  unit?: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  vatRate: number;
}

/** Đơn được hóa đơn bao phủ (mã hiển thị để nhân viên đối chiếu). */
export interface InvoiceOrderRef {
  id: number;
  orderCode: string;
}

/**
 * Hóa đơn điện tử kèm dữ liệu đối chiếu: liên kết đúng 1 payment (thành công) và các đơn của payment đó.
 * `Invoice.subtotalAmount` là trước VAT; `items[].unitPrice/amount` là giá hiển thị cho khách (đã gồm VAT, như trên đơn).
 * Hóa đơn mock phục vụ demo, không có giá trị pháp lý.
 */
export interface InvoiceDetail extends Invoice {
  paymentId: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentGatewayStatus;
  paidAt: IsoDateTime;
  orders: InvoiceOrderRef[];
  items: InvoiceItem[];
  /** Tạm tính: tổng gross các dòng, trước giảm giá. */
  grossAmount: number;
  /** Giảm giá món + voucher. */
  discountAmount: number;
  deliveryFee: number;
}

// ── Payment inputs / results ──────────────────────────────────────────
export interface InvoiceRequestInput {
  buyerName: string;
  buyerTaxCode?: string;
  buyerAddress?: string;
  email?: string;
}

/**
 * Thanh toán 1..N đơn. 1 đơn → 1 allocation; thanh toán cả bàn → N allocation.
 * Server tính số tiền = tổng phần còn lại của các đơn.
 */
export interface PayOrdersInput {
  orderIds: number[];
  method: PaymentMethod;
  /** Chỉ Cash */
  cashReceived?: number;
  /** Có = yêu cầu xuất hoá đơn điện tử */
  invoice?: InvoiceRequestInput;
  idempotencyKey?: string;
}

/** Kết quả IPN giả lập của cổng thanh toán mock (POST /payment/payments/:id/simulate). */
export type SimulatedPaymentResult = 'success' | 'failed' | 'expired';

export interface SimulatePaymentInput {
  result: SimulatedPaymentResult;
}

export interface PayResult {
  payment: Payment;
  allocations: PaymentOrderAllocation[];
  /** VNPay/Momo: URL chuyển hướng sang cổng thanh toán */
  redirectUrl?: string | null;
  invoice?: Invoice | null;
}

export interface OpenCashierShiftInput {
  branchId: number;
  registerCode?: string;
  openingCash: number;
}

export interface CloseCashierShiftInput {
  closingCash: number;
}

export interface CashMovementInput {
  movementType: CashMovementType;
  amount: number;
  reason: string;
}

export interface CreateRefundInput {
  paymentId: number;
  refundMethod: RefundMethod;
  amount: number;
  reason: string;
  allocations: {
    orderId: number;
    amount: number;
    restockInventory?: boolean;
    reverseLoyalty?: boolean;
  }[];
}

// ══════════════════════════════════════════════════════════════════════
// 06. Inventory
// ══════════════════════════════════════════════════════════════════════
export type SupplierStatus = 'Active' | 'Inactive';
export type StockReservationStatus = 'Reserved' | 'Committed' | 'Released' | 'Expired';
export type PurchaseOrderStatus =
  | 'Draft'
  | 'Ordered'
  | 'Partially_Received'
  | 'Received'
  | 'Cancelled';
export type InventoryTransactionType =
  | 'Import'
  | 'Auto_Deduct'
  | 'Refund'
  | 'Waste'
  | 'Adjustment'
  | 'Stocktake';

export interface Ingredient {
  id: number;
  name: string;
  unit: string; // đơn vị cơ sở: g, ml
  isActive: boolean;
}

export interface Supplier {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  taxCode?: string | null;
  address?: string | null;
  status: SupplierStatus;
}

export interface Recipe {
  id: number;
  variantId: number;
  ingredientId: number;
  quantityRequired: number;
}

export interface OptionRecipeAdjustment {
  id: number;
  optionId: number;
  ingredientId: number;
  /** dương: thêm, âm: giảm so với recipe gốc */
  quantityDelta: number;
}

export interface Inventory {
  id: number;
  branchId: number;
  ingredientId: number;
  quantityInStock: number;
  /** Đang giữ cho đơn mở; available = inStock - reserved */
  reservedQuantity: number;
  /** ≤ mức này → phát inventory.ingredient.low_stock */
  reorderLevel: number;
  averageCost: number;
  version: number;
  updatedAt: IsoDateTime;
}

export interface StockReservation {
  id: number;
  orderId: number;
  branchId: number;
  ingredientId: number;
  quantity: number;
  status: StockReservationStatus;
  expiresAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PurchaseOrder {
  id: number;
  branchId: number;
  supplierId: number;
  totalAmount: number;
  status: PurchaseOrderStatus;
  createdBy: string;
  approvedBy?: string | null;
  orderedAt?: IsoDateTime | null;
  expectedAt?: IsoDateTime | null;
  receivedAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface PODetail {
  id: number;
  poId: number;
  ingredientId: number;
  purchaseUnit: string; // kg, hộp...
  conversionFactor: number; // đơn vị cơ sở / purchaseUnit
  quantity: number; // theo purchaseUnit
  receivedQuantity: number;
  unitPrice: number; // / purchaseUnit
  baseQuantity: number; // generated = quantity * conversionFactor
  lineTotal: number; // generated
}

export interface InventoryLog {
  id: number;
  idempotencyKey?: string | null;
  branchId: number;
  ingredientId: number;
  transactionType: InventoryTransactionType;
  /** Import/Refund > 0; Auto_Deduct/Waste < 0; Adjustment/Stocktake ≠ 0 */
  quantityChanged: number;
  balanceAfter: number;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null; // bắt buộc với Waste/Adjustment/Stocktake
  createdBy?: string | null;
  createdAt: IsoDateTime;
}

// ── Inventory view models / inputs ────────────────────────────────────
export interface InventoryItemView extends Inventory {
  ingredientName: string;
  unit: string;
  available: number; // inStock - reserved
  isLow: boolean; // inStock <= reorderLevel
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  supplierName: string;
  details: (PODetail & { ingredientName: string })[];
}

export interface ListInventoryParams {
  branchId: number;
  q?: string;
  lowOnly?: boolean;
}

export interface ListInventoryLogsParams extends PageParams {
  branchId: number;
  ingredientId?: number;
  transactionType?: InventoryTransactionType;
  /** Khoảng thời gian (bao gồm 2 đầu). */
  from?: IsoDateTime;
  to?: IsoDateTime;
}

/** Điều chỉnh thủ công: Waste/Adjustment/Stocktake – bắt buộc có lý do. */
export interface AdjustInventoryInput {
  branchId: number;
  ingredientId: number;
  transactionType: 'Waste' | 'Adjustment' | 'Stocktake';
  quantityChanged: number;
  reason: string;
  /** Inventory.version lúc người dùng xem; lệch → 409 VERSION_CONFLICT (optimistic locking). */
  version: number;
}

// ══════════════════════════════════════════════════════════════════════
// 07. Engagement
// ══════════════════════════════════════════════════════════════════════
export type LoyaltyTxType = 'Earn' | 'Redeem' | 'Reversal' | 'Adjustment';
export type VoucherDiscountType = 'Percent' | 'Fixed';
export type VoucherStatus = 'Active' | 'Inactive';
export type ApplicableFulfillment = 'All' | 'Delivery' | 'Pickup' | 'Dine_In';
export type VoucherRedemptionStatus = 'Applied' | 'Reversed';
export type ReviewStatus = 'Pending' | 'Approved' | 'Hidden';
export type NotificationChannel = 'Push' | 'Email' | 'SMS' | 'In_App';
export type NotificationStatus = 'Pending' | 'Sent' | 'Failed';
export type DevicePlatform = 'iOS' | 'Android' | 'Web';

/** 10 tem = 1 ly miễn phí. */
export const LOYALTY_STAMPS_PER_REWARD = 10;

export interface LoyaltyCard {
  id: number;
  userId: string;
  currentStamps: number; // có thể âm (stamp debt, tối thiểu -100)
  lifetimeStampsEarned: number;
  totalRedeemedCups: number;
  version: number;
  updatedAt: IsoDateTime;
}

export interface LoyaltyTransaction {
  id: number;
  idempotencyKey?: string | null;
  userId: string;
  orderId?: number | null;
  transactionType: LoyaltyTxType;
  stamps: number; // signed; Redeem = -10
  balanceAfter: number;
  reversalOfId?: number | null;
  note?: string | null;
  createdBy?: string | null;
  createdAt: IsoDateTime;
}

export interface Voucher {
  id: number;
  code: string;
  name: string;
  discountType: VoucherDiscountType;
  discountValue: number; // Percent: 1-100; Fixed: VND
  maxDiscountAmount?: number | null;
  minOrderAmount: number;
  branchId?: number | null; // null = mọi chi nhánh
  applicableFulfillment: ApplicableFulfillment;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  usageLimitTotal?: number | null; // null = không giới hạn
  usageLimitPerUser: number;
  usedCount: number;
  status: VoucherStatus;
  createdAt: IsoDateTime;
}

export interface VoucherRedemption {
  id: number;
  voucherId: number;
  userId: string;
  orderId: number;
  discountAmount: number;
  status: VoucherRedemptionStatus;
  createdAt: IsoDateTime;
}

/** Read-model điền từ order.completed – điều kiện để được review. */
export interface VerifiedPurchase {
  orderItemId: number;
  orderId: number;
  userId: string;
  productId: number;
  branchId: number;
  purchasedAt: IsoDateTime;
}

export interface ProductReview {
  id: number;
  productId: number;
  userId: string;
  orderItemId: number;
  rating: number; // 1..5
  comment?: string | null;
  status: ReviewStatus;
  moderatedBy?: string | null;
  moderatedAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface DeviceToken {
  id: number;
  userId: string;
  platform: DevicePlatform;
  token: string;
  isActive: boolean;
  createdAt: IsoDateTime;
  lastSeenAt?: IsoDateTime | null;
}

export interface Notification {
  id: number;
  userId: string;
  type: string; // order_status, promotion, loyalty...
  channel: NotificationChannel;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  status: NotificationStatus;
  isRead: boolean;
  sentAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
}

// ── Engagement view models / inputs ───────────────────────────────────
export interface LoyaltySummary {
  card: LoyaltyCard;
  recentTransactions: LoyaltyTransaction[];
  /** Số tem còn thiếu để được ly miễn phí tiếp theo (0 nếu đã đủ) */
  stampsToNextReward: number;
  canRedeem: boolean;
}

export interface ValidateVoucherInput {
  code: string;
  branchId: number;
  fulfillmentType: FulfillmentType;
  /** Tạm tính (sau giảm giá món) dùng để kiểm tra min_order_amount */
  subTotal: number;
  userId?: string;
}

export interface VoucherValidation {
  valid: boolean;
  voucher?: Voucher | null;
  discountAmount: number;
  /** Mã lý do khi invalid: NOT_FOUND | INACTIVE | NOT_STARTED | EXPIRED | MIN_ORDER | BRANCH | FULFILLMENT | USAGE_LIMIT */
  reason?: string | null;
  message?: string | null;
}

// ══════════════════════════════════════════════════════════════════════
// 08. Intelligence
// ══════════════════════════════════════════════════════════════════════
export type ChatSessionStatus = 'Active' | 'Waiting_Staff' | 'Handed_Off' | 'Closed';
export type ChatSenderRole = 'Customer' | 'AI' | 'Staff';
export type KnowledgeCategory = 'FAQ' | 'SOP_Staff' | 'Policy' | 'Menu_Guide';
export type KnowledgeAudience = 'Customer' | 'Staff' | 'Both';
export type KnowledgeStatus = 'Active' | 'Hidden';
export type ForecastType = 'Revenue' | 'Product_Demand' | 'Ingredient_Usage';
export type RecommendationType = 'Cross_Sell' | 'Up_Sell' | 'Personalized' | 'Trending';

export interface ChatSession {
  id: number;
  userId?: string | null; // null = khách vãng lai
  guestKey?: string | null;
  staffUserId?: string | null; // nhân viên tiếp nhận
  branchId?: number | null;
  status: ChatSessionStatus;
  handedOffAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
  closedAt?: IsoDateTime | null;
}

export interface ChatMessage {
  id: number;
  sessionId: number;
  senderRole: ChatSenderRole;
  senderUserId?: string | null; // bắt buộc với Staff
  content: string;
  /** model, id Knowledge_Base đã truy xuất, token usage... */
  metadata?: Record<string, unknown> | null;
  createdAt: IsoDateTime;
}

export interface KnowledgeBase {
  id: number;
  category: KnowledgeCategory;
  audience: KnowledgeAudience; // SOP_Staff luôn là Staff
  language: string; // 'vi'
  title: string;
  content: string;
  keywords?: string | null;
  version: number;
  status: KnowledgeStatus;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface AIForecast {
  id: number;
  branchId: number;
  forecastType: ForecastType;
  /** 0 = Revenue; variantId = Product_Demand; ingredientId = Ingredient_Usage */
  targetId: number;
  forecastDate: IsoDate;
  predictedValue: number; // VND (Revenue) hoặc đơn vị
  lowerBound?: number | null;
  upperBound?: number | null;
  /** Back-fill sau để đo độ chính xác */
  actualValue?: number | null;
  modelVersion: string;
  runId: string;
  rawData?: unknown;
  isLatest: boolean;
  generatedAt: IsoDateTime;
}

export interface AIRecommendation {
  id: number;
  userId: string;
  branchId?: number | null;
  productId: number;
  recommendationType: RecommendationType;
  confidenceScore: number; // 0..1
  reason?: string | null;
  modelVersion: string;
  expiresAt?: IsoDateTime | null;
  clickedAt?: IsoDateTime | null;
  purchasedAt?: IsoDateTime | null;
  orderId?: number | null;
  createdAt: IsoDateTime;
}

// ── Intelligence view models / inputs ─────────────────────────────────
export interface RecommendationView extends AIRecommendation {
  product: MenuProduct;
}

export interface ListForecastsParams {
  branchId: number;
  forecastType: ForecastType;
  targetId?: number;
  from?: IsoDate;
  to?: IsoDate;
}

export interface CreateChatSessionInput {
  userId?: string;
  guestKey?: string;
  branchId?: number;
}

export interface SendChatMessageInput {
  content: string;
}

export interface ChatReply {
  /** Tin nhắn người dùng vừa gửi + (nếu có) câu trả lời của AI */
  messages: ChatMessage[];
  session: ChatSession;
}

export interface ListChatSessionsParams {
  branchId?: number;
  status?: ChatSessionStatus | ChatSessionStatus[];
}