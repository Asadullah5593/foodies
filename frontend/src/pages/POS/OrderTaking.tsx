import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdClose, MdOutlineWarningAmber, MdOutlineSchedule, MdOutlineRestaurantMenu, MdOutlineStorefront } from 'react-icons/md';
import { Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';
import { menuService, orderService, adminService, CreateOrderRequest } from '../../services/api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import { validatePakistaniPhone, PAKISTANI_PHONE_PLACEHOLDER, normalizePakistaniPhone } from '../../utils/phone';
import { MenuItem } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import { bogoDealTotal } from '../../utils/bogoPricing';
import Button from '../../components/Button';
import Card from '../../components/Card';
import SearchableSelect from '../../components/SearchableSelect';
import Modal from '../../components/Modal';
import CustomerInvoiceModal from '../../components/CustomerInvoiceModal';
import { useQueryClient } from '@tanstack/react-query';
import {
  POSLayout,
  POSFilters,
  OrderTypeSelector,
  MenuGrid,
  MENU_PAGE_SIZE,
  CustomerPanel,
  CartPanel,
  PaymentPanel,
  ItemConfigModal,
  DealConfigModal,
} from './components';
import type { OrderTypeOption, CartLine, DealComponentLine } from './components';
import type { KioskFinalizeRequest } from '../../services/api/orderService';
import { defaultVariantIdForItem } from './components/types';
import { isMenuItemAvailableForOrderType } from '../../utils/menu-order-type';
import { cartLineSupportsOrderType } from './orderTypeSupport';
import { computeModifiersPrice, resolveMinSelect, resolveMaxSelect, sizeKeyForSelection } from '../../utils/modifierPricing';

const OrderTaking: React.FC = () => {
  const [selectedItems, setSelectedItems] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderTypeOption | null>(null);
  const [pendingOrderTypeChange, setPendingOrderTypeChange] = useState<{
    next: OrderTypeOption;
    removable: CartLine[];
  } | null>(null);
  const [tableNumber, setTableNumber] = useState('');
  const [discountCode, setDiscountCode] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [loyaltyPointsToRedeem, setLoyaltyPointsToRedeem] = useState<number | ''>('');
  const [phoneError, setPhoneError] = useState('');
  const [justAddedItem, setJustAddedItem] = useState<number | null>(null);
  const [showItemModal, setShowItemModal] = useState(false);
  const [selectedItemForConfig, setSelectedItemForConfig] = useState<MenuItem | null>(null);
  const [itemConfig, setItemConfig] = useState<{
    variantId?: number;
    addons: Array<{ addonId: number; quantity: number }>;
    modifiers: Array<{ modifierId: number; quantity: number }>;
    notes?: string;
  }>({ addons: [], modifiers: [] });
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [lastOrderGroupId, setLastOrderGroupId] = useState<string | null>(null);
  const [showCustomerInvoiceModal, setShowCustomerInvoiceModal] = useState(false);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [addCustomerName, setAddCustomerName] = useState('');
  const [addCustomerPhone, setAddCustomerPhone] = useState('');
  const [addCustomerPhoneError, setAddCustomerPhoneError] = useState('');
  const [linkConfirm, setLinkConfirm] = useState<{ name: string; phone: string; existingName: string | null } | null>(null);
  const [orderNotes, setOrderNotes] = useState('');
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [posSearch, setPosSearch] = useState('');
  const debouncedPosSearch = useDebouncedValue(posSearch, 300);
  const [paymentMode, setPaymentMode] = useState<'cash' | 'card' | 'multipay'>('cash');
  const [paymentCashAmount, setPaymentCashAmount] = useState<string>('');
  const [paymentCardAmount, setPaymentCardAmount] = useState<string>('');
  // Selected bank card (for card-linked discounts); only meaningful when paying fully by card.
  const [bankCardId, setBankCardId] = useState<number | null>(null);
  const { data: bankCards } = useQuery({
    queryKey: ['pos-bank-cards'],
    queryFn: () => adminService.getBankCards(true),
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentMenuPage, setCurrentMenuPage] = useState(1);
  const [removeConfirmIndex, setRemoveConfirmIndex] = useState<number | null>(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showDealModal, setShowDealModal] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<import('../../services/api/menuService').DealDefinition | null>(null);
  const [editingCartIndex, setEditingCartIndex] = useState<number | null>(null);
  const [editingDealIndex, setEditingDealIndex] = useState<number | null>(null);
  const [dealInitialComponents, setDealInitialComponents] = useState<import('./components/types').DealComponentLine[] | null>(null);
  // Kiosk "pay at counter": a loaded kiosk cart links the in-progress order to a kiosk code.
  const [activeKioskCode, setActiveKioskCode] = useState<string | null>(null);
  const [kioskInfo, setKioskInfo] = useState<{ price_changed: boolean; items_dropped: boolean; snapshot_total: number; current_total: number } | null>(null);
  const [showKioskModal, setShowKioskModal] = useState(false);
  const [kioskCodeInput, setKioskCodeInput] = useState('');
  const [kioskLoading, setKioskLoading] = useState(false);
  const [pendingKioskCart, setPendingKioskCart] = useState<CartLine[] | null>(null);
  const queryClient = useQueryClient();
  const searchInputRefDesktop = useRef<HTMLInputElement>(null);
  const searchInputRefMobile = useRef<HTMLInputElement>(null);

  const { data: posBranches, isLoading: loadingBranches } = useQuery({
    queryKey: ['pos-branches'],
    queryFn: () => menuService.getPosBranches(),
  });

  const effectiveBranchId = selectedBranchId ?? posBranches?.[0]?.id ?? null;

  const { data: branchMenu, isLoading } = useQuery({
    queryKey: ['pos-menu', effectiveBranchId],
    queryFn: () => menuService.getBranchMenu(effectiveBranchId!),
    enabled: effectiveBranchId != null,
  });

  const rawMenu = branchMenu?.menu ?? [];
  const brands = branchMenu?.brands ?? [];
  const branchId = branchMenu?.branch_id ?? null;

  const orderTypeOptions = React.useMemo((): { value: OrderTypeOption; label: string }[] => {
    const list: { value: OrderTypeOption; label: string }[] = [];
    if (branchMenu?.supports_dine_in === true) list.push({ value: 'dine_in', label: 'Dine In' });
    if (branchMenu?.supports_takeaway === true)
      list.push({ value: 'takeaway', label: 'Takeaway' });
    if (branchMenu?.supports_delivery === true) list.push({ value: 'delivery', label: 'Delivery' });
    return list.length ? list : [{ value: 'dine_in', label: 'Dine In' }];
  }, [branchMenu?.supports_dine_in, branchMenu?.supports_takeaway, branchMenu?.supports_delivery]);

  const effectiveOrderType: OrderTypeOption | null =
    orderType != null && orderTypeOptions.some((o) => o.value === orderType) ? orderType : null;

  React.useEffect(() => {
    if (orderType != null && !orderTypeOptions.some((o) => o.value === orderType)) {
      setOrderType(null);
    }
  }, [orderType, orderTypeOptions]);

  /** When an order type is selected, filter by `available_for_order_types` (runtime; full menu is loaded once). */
  const menuAll = React.useMemo(() => {
    if (effectiveOrderType == null) return rawMenu;
    return rawMenu.filter((item: MenuItem) =>
      isMenuItemAvailableForOrderType(item.available_for_order_types ?? null, effectiveOrderType),
    );
  }, [rawMenu, effectiveOrderType]);
  const menuByBrand = selectedBrandId == null
    ? menuAll
    : menuAll.filter((item: MenuItem) => item.brand_id === selectedBrandId);
  const categoriesFromMenu = React.useMemo(() => {
    const seen = new Map<number, string>();
    (menuByBrand as MenuItem[]).forEach((item) => {
      const id = item.category_id ?? (typeof item.category === 'object' && item.category?.id) ?? 0;
      const name =
        typeof item.category === 'string'
          ? item.category
          : (item.category as { name?: string } | undefined)?.name ?? 'Uncategorised';
      if (id && !seen.has(id)) seen.set(id, name);
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [menuByBrand]);
  const menu = selectedCategoryId == null
    ? menuByBrand
    : menuByBrand.filter((item: MenuItem) => (item.category_id ?? item.category?.id) === selectedCategoryId);

  const posSearchTypeaheadOptions = React.useMemo(
    () =>
      (menu as MenuItem[]).map((i) => ({
        id: String(i.id),
        label: i.name ?? '',
      })),
    [menu],
  );
  const posSearchTypeahead = useTypeaheadSuggestions({
    query: debouncedPosSearch,
    options: posSearchTypeaheadOptions,
    minChars: 2,
    limit: 8,
  });

  const menuFilteredBySearch = React.useMemo(() => {
    if (!debouncedPosSearch.trim()) return menu;
    const q = debouncedPosSearch.trim().toLowerCase();
    return menu.filter(
      (item: MenuItem) =>
        (item.name || '').toLowerCase().includes(q) ||
        (item.description || '').toLowerCase().includes(q),
    );
  }, [menu, debouncedPosSearch]);

  React.useEffect(() => setCurrentMenuPage(1), [debouncedPosSearch, selectedBrandId, selectedCategoryId, effectiveOrderType]);

  const paginatedMenu = React.useMemo(() => {
    const start = (currentMenuPage - 1) * MENU_PAGE_SIZE;
    return menuFilteredBySearch.slice(start, start + MENU_PAGE_SIZE);
  }, [menuFilteredBySearch, currentMenuPage]);

  const openShift = branchMenu?.open_shift ?? null;
  /** Brands with an open shift at this branch (shifts are per brand). */
  const openShiftBrandIds = branchMenu?.open_shift_brand_ids ?? [];
  /** Orders are single-brand: the cart's brand is fixed by its first line. */
  const cartBrandId = selectedItems.length
    ? (selectedItems[0].menuItem.brand_id ?? null)
    : null;

  const getBrandName = (brandId: number | null | undefined): string | null =>
    brandId != null ? (brands.find((b) => b.id === brandId)?.name ?? null) : null;

  const orderTypeSupportsLine = React.useCallback(
    (line: CartLine, type: OrderTypeOption): boolean =>
      cartLineSupportsOrderType(line, type, rawMenu as MenuItem[]),
    [rawMenu],
  );

  /**
   * Switching order channel keeps the cart — only lines the new channel can't
   * fulfil are dropped. If any exist, confirm first (cancel keeps the current
   * type and the full cart). Reset-to-null, kiosk-load and branch-change paths
   * call setOrderType directly and are intentionally unaffected.
   */
  const handleOrderTypeChange = (next: OrderTypeOption) => {
    if (next === orderType) return;
    const removable = selectedItems.filter((l) => !orderTypeSupportsLine(l, next));
    if (removable.length === 0) {
      setOrderType(next);
      return;
    }
    setPendingOrderTypeChange({ next, removable });
  };

  const confirmOrderTypeChange = () => {
    if (!pendingOrderTypeChange) return;
    const { next } = pendingOrderTypeChange;
    const kept = selectedItems.filter((l) => orderTypeSupportsLine(l, next));
    setSelectedItems(kept);
    setOrderType(next);
    setPendingOrderTypeChange(null);
    // Switching inside Checkout can empty the cart. Leaving the modal open would
    // strand the cashier on a disabled Pay button, so send them back to the menu.
    if (kept.length === 0 && showCheckoutModal) {
      setShowCheckoutModal(false);
      toast('Cart is empty — no items are available for the new order type.');
    }
  };

  /**
   * Load a kiosk cart AFTER the order-type change has cleared the cart above.
   * Defined after the clear effect so it runs second in the same commit, otherwise
   * setting orderType during a kiosk load would wipe the lines we just set.
   */
  React.useEffect(() => {
    if (pendingKioskCart != null) {
      setSelectedItems(pendingKioskCart);
      setPendingKioskCart(null);
    }
  }, [pendingKioskCart]);

  // Tender split for per-tender GST (cash vs card). All-cash/all-card send a 1/0 ratio; a
  // split sends the entered amounts. Included in the quote payload so the quote re-runs (and
  // Tax/Total update) whenever the cashier toggles the tender or edits the split.
  const paymentSplit =
    paymentMode === 'card'
      ? { cash_amount: 0, card_amount: 1 }
      : paymentMode === 'multipay'
        ? {
            cash_amount: parseFloat(paymentCashAmount || '0') || 0,
            card_amount: parseFloat(paymentCardAmount || '0') || 0,
          }
        : { cash_amount: 1, card_amount: 0 };

  const quotePayload =
    branchId != null && selectedItems.length > 0 && effectiveOrderType != null
    ? {
        branch_id: branchId,
        order_type: effectiveOrderType,
        payment_split: paymentSplit,
        // Card-linked discounts only apply on full-card tender.
        bank_card_id: paymentMode === 'card' ? bankCardId : null,
        items: selectedItems.map((item) => {
          if (item.dealId != null && item.components?.length) {
            return {
              deal_menu_item_id: item.dealId,
              quantity: item.quantity,
              components: item.components.map((c) => ({
                slot_index: c.slot_index ?? 0,
                menu_item_id: c.menuItem.id,
                quantity: c.quantity,
                variant_id: c.variantId,
                addons: c.addons.map((a) => ({ addon_id: a.addonId, quantity: a.quantity })),
                modifiers: c.modifiers?.length ? c.modifiers.map((m) => ({ modifier_id: m.modifierId, quantity: m.quantity })) : undefined,
              })),
            };
          }
          return {
            menu_item_id: item.menuItem.id,
            quantity: item.quantity,
            variant_id: item.variantId,
            addons: item.addons.map((a) => ({ addon_id: a.addonId, quantity: a.quantity })),
            modifiers: item.modifiers?.length ? item.modifiers.map((m) => ({ modifier_id: m.modifierId, quantity: m.quantity })) : undefined,
          };
        }),
        discount_code: discountCode.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
        loyalty_points_to_redeem: typeof loyaltyPointsToRedeem === 'number' && loyaltyPointsToRedeem > 0 ? loyaltyPointsToRedeem : undefined,
      }
    : null;

  const { data: quoteData } = useQuery({
    queryKey: ['pos-quote', quotePayload],
    queryFn: () => orderService.getQuote(quotePayload!),
    enabled: quotePayload != null,
    // The payload IS the key, so any cart/order-type edit re-prices. Hold the last
    // quote while that lands: without it every total falls back to a raw sum with
    // no tax or discount, which is visible as a wrong price inside Checkout.
    placeholderData: keepPreviousData,
  });
  /**
   * There is no quote when there is nothing to quote. An empty cart nulls the
   * payload, which DISABLES the query — and a disabled query never refetches, so
   * keepPreviousData would otherwise serve the last cart's total forever (an empty
   * cart still showing Rs. 949). Gate on the payload rather than on the query's
   * own state so this cannot drift with react-query's placeholder semantics.
   */
  const quote = quotePayload != null ? quoteData : undefined;

  // Cash-vs-card preview: GST differs per tender (e.g. 16% cash / 5% card), so show the
  // customer both outcomes before a tender is picked. Derived from the current quote's
  // rates; the quote itself re-runs (discounts included) once the cashier toggles the tender,
  // so this is a preview — the charged figures always come from the re-quoted totals.
  const tenderPreview = (() => {
    if (!quote) return null;
    const rateCash = Number(quote.tax_rate_cash ?? 0);
    const rateCard = Number(quote.tax_rate_card ?? 0);
    if (rateCash === rateCard) return null; // same rate — nothing to compare
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const afterDiscount = Math.max(
      0,
      round2((Number(quote.subtotal) || 0) - (Number(quote.discount_amount) || 0) - (Number(quote.loyalty_discount) || 0)),
    );
    const extras = (Number(quote.service_charge) || 0) + (Number(quote.delivery_fee) || 0);
    const cashTax = round2(afterDiscount * rateCash);
    const cardTax = round2(afterDiscount * rateCard);
    return {
      rateCash, rateCard, cashTax, cardTax,
      cashTotal: round2(afterDiscount + extras + cashTax),
      cardTotal: round2(afterDiscount + extras + cardTax),
    };
  })();

  const renderTenderPreview = () =>
    tenderPreview && (
      <div className="mb-2 space-y-1 rounded-lg bg-foodies-background dark:bg-slate-700/40 px-3 py-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-foodies-textSecondary dark:text-slate-400">
            Pay by cash — incl. {Math.round(tenderPreview.rateCash * 100)}% GST ({formatCurrency(tenderPreview.cashTax)})
          </span>
          <span className="font-semibold text-foodies-textPrimary dark:text-slate-100">
            {formatCurrency(tenderPreview.cashTotal)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-foodies-textSecondary dark:text-slate-400">
            Pay by card — incl. {Math.round(tenderPreview.rateCard * 100)}% GST ({formatCurrency(tenderPreview.cardTax)})
          </span>
          <span className="font-semibold text-foodies-textPrimary dark:text-slate-100">
            {formatCurrency(tenderPreview.cardTotal)}
          </span>
        </div>
      </div>
    );

  const normalizedPhone = customerPhone.trim() ? normalizePakistaniPhone(customerPhone.trim()) : null;
  // POS redeems against the brand-scoped POS wallet, so the balance depends on
  // the cart's brand. Refetch when the cart brand changes.
  const { data: loyaltyBalance } = useQuery({
    queryKey: ['loyalty-balance', branchId, normalizedPhone, cartBrandId],
    queryFn: async () => {
      const res = await apiClient.get<{ balance: number; displayName: string }>('/public/consumer/loyalty/balance', {
        params: { branch_id: branchId, phone: normalizedPhone, wallet_type: 'pos', brand_id: cartBrandId },
      });
      return res.data;
    },
    enabled: branchId != null && normalizedPhone != null && cartBrandId != null,
  });

  React.useEffect(() => {
    const maxAllowed = loyaltyBalance?.balance ?? 0;
    if (typeof loyaltyPointsToRedeem === 'number' && loyaltyPointsToRedeem > maxAllowed) {
      setLoyaltyPointsToRedeem(maxAllowed);
    }
  }, [loyaltyBalance?.balance]);

  const addCustomerMutation = useMutation({
    mutationFn: (data: { name: string; phone: string; link?: boolean }) => adminService.createCustomer(data),
    onSuccess: (newCustomer: { id: number; name: string | null; phone: string; linked?: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setCustomerName((newCustomer.name ?? '').trim());
      setCustomerPhone((newCustomer.phone ?? '').trim());
      setPhoneError('');
      setShowAddCustomerModal(false);
      setAddCustomerName('');
      setAddCustomerPhone('');
      setAddCustomerPhoneError('');
      setLinkConfirm(null);
      toast.success(newCustomer.linked ? 'Linked existing customer' : 'Customer added');
    },
    onError: (err: any, variables) => {
      const existing = err.response?.status === 409 ? err.response?.data?.existing : null;
      if (existing) {
        // Phone belongs to a sibling brand's customer — confirm before linking.
        setShowAddCustomerModal(false);
        setLinkConfirm({ name: variables.name, phone: variables.phone, existingName: existing.name ?? null });
        return;
      }
      toast.error(err.response?.data?.message || 'Failed to add customer');
    },
  });

  const createOrderMutation = useMutation({
    mutationFn: async (arg: {
      order: CreateOrderRequest;
      payments: Array<{ method: 'cash' | 'card'; amount: number }>;
    }) => orderService.createOrder(arg.order),
    onSuccess: async (
      data: { order_group_id: string; orders: Array<{ id: number; order_number: string; total_amount?: number }> },
      variables: { order: CreateOrderRequest; payments: Array<{ method: 'cash' | 'card'; amount: number }> }
    ) => {
      const orders = data?.orders ?? [];
      const payments = variables?.payments ?? [];
      const grandTotal = orders.reduce((sum, o) => sum + Number(o?.total_amount ?? 0), 0);
      if (orders.length > 0 && payments.length > 0 && grandTotal > 0) {
        for (const order of orders) {
          const orderTotal = Number(order.total_amount ?? 0);
          if (orderTotal <= 0) continue;
          const ratio = orderTotal / grandTotal;
          for (const p of payments) {
            const amount = Math.round(p.amount * ratio * 100) / 100;
            if (amount > 0) {
              await orderService.processPayment(order.id, {
                payment_method: p.method,
                amount,
              });
            }
          }
        }
      }
      const grossTotal = orders.reduce((sum, o) => sum + Number(o?.total_amount ?? 0), 0);
      const groupId = data?.order_group_id ?? '';
      if (groupId) {
        setLastOrderGroupId(groupId);
        setShowCustomerInvoiceModal(true);
      }
      if (orders.length === 0) {
        toast.success('Order created successfully!');
      } else if (orders.length === 1) {
        toast.success(`Order #${orders[0]?.order_number ?? ''} created. Total: ${formatCurrency(grossTotal)}${groupId ? ` (Group: ${groupId.slice(0, 8)}…)` : ''}`);
      } else {
        toast.success(`${orders.length} orders created. Group: ${groupId.slice(0, 8)}… | Gross total: ${formatCurrency(grossTotal)}`);
      }
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
      queryClient.invalidateQueries({ queryKey: ['kitchen-display-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      setShowCheckoutModal(false);
      setDrawerOpen(false);
      setSelectedItems([]);
      setTableNumber('');
      setDiscountCode('');
      setCustomerName('');
      setCustomerPhone('');
      setDeliveryAddress('');
      setLoyaltyPointsToRedeem('');
      setPhoneError('');
      setPaymentCashAmount('');
      setPaymentCardAmount('');
      setOrderType(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create order');
    },
  });

  // Finalize a loaded kiosk cart. Payments are applied server-side, so onSuccess
  // does NOT loop processPayment (unlike createOrderMutation).
  const finalizeKioskMutation = useMutation({
    mutationFn: async (arg: { code: string; body: KioskFinalizeRequest }) =>
      orderService.finalizeKioskOrder(arg.code, arg.body),
    onSuccess: (
      data: { order_group_id: string; orders: Array<{ order_number: string; total_amount?: number }>; kiosk_code?: string },
    ) => {
      const orders = data?.orders ?? [];
      const grossTotal = orders.reduce((sum, o) => sum + Number(o?.total_amount ?? 0), 0);
      const groupId = data?.order_group_id ?? '';
      if (groupId) {
        setLastOrderGroupId(groupId);
        setShowCustomerInvoiceModal(true);
      }
      toast.success(`Kiosk order #${data?.kiosk_code ?? activeKioskCode ?? ''} placed. Total: ${formatCurrency(grossTotal)}`);
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
      queryClient.invalidateQueries({ queryKey: ['kitchen-display-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      setShowCheckoutModal(false);
      setDrawerOpen(false);
      setSelectedItems([]);
      setTableNumber('');
      setDiscountCode('');
      setCustomerName('');
      setCustomerPhone('');
      setDeliveryAddress('');
      setLoyaltyPointsToRedeem('');
      setPhoneError('');
      setPaymentCashAmount('');
      setPaymentCardAmount('');
      setOrderType(null);
      setActiveKioskCode(null);
      setKioskInfo(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to finalize kiosk order');
    },
  });


  const lineConfigMatch = (
    a: { menu_item_id: number; variantId?: number; addons: Array<{ addonId: number; quantity: number }>; modifiers?: Array<{ modifierId: number; quantity: number }>; notes?: string },
    b: { menuItem: MenuItem; variantId?: number; addons: Array<{ addonId: number; quantity: number }>; modifiers?: Array<{ modifierId: number; quantity: number }>; notes?: string }
  ) => {
    if (a.menu_item_id !== b.menuItem.id) return false;
    if ((a.variantId ?? null) !== (b.variantId ?? null)) return false;
    if ((a.notes ?? '').trim() !== (b.notes ?? '').trim()) return false;
    const addonsA = [...a.addons].sort((x, y) => x.addonId - y.addonId);
    const addonsB = [...(b.addons ?? [])].sort((x, y) => x.addonId - y.addonId);
    if (addonsA.length !== addonsB.length) return false;
    if (addonsA.some((x, i) => x.addonId !== addonsB[i].addonId || x.quantity !== addonsB[i].quantity)) return false;
    const modsA = [...(a.modifiers ?? [])].sort((x, y) => x.modifierId - y.modifierId);
    const modsB = [...(b.modifiers ?? [])].sort((x, y) => x.modifierId - y.modifierId);
    if (modsA.length !== modsB.length) return false;
    if (modsA.some((x, i) => x.modifierId !== modsB[i].modifierId || x.quantity !== modsB[i].quantity)) return false;
    return true;
  };

  const addItem = async (item: MenuItem) => {
    if (!openShift) {
      toast.error('Open a shift in Admin → Shifts before adding items to the order');
      return;
    }
    if (orderType == null || !orderTypeOptions.some((o) => o.value === orderType)) {
      toast.error('Select an order type before adding items');
      return;
    }
    // Single-brand orders: a cart can only hold one brand's items.
    const itemBrandId = item.brand_id ?? null;
    if (cartBrandId != null && itemBrandId != null && itemBrandId !== cartBrandId) {
      toast.error(
        `This order already has ${getBrandName(cartBrandId) ?? 'another brand'}'s items. Place a separate order per brand.`,
      );
      return;
    }
    // Each brand sells only while its own shift is open at this branch.
    if (
      itemBrandId != null &&
      !openShiftBrandIds.includes(itemBrandId)
    ) {
      toast.error(
        `No shift is open for ${getBrandName(itemBrandId) ?? 'this brand'} at this branch. Open the brand's shift first.`,
      );
      return;
    }
    if (branchId != null) {
      try {
        const deal = await menuService.getDeal(
          item.id,
          branchId,
          effectiveOrderType ?? undefined,
        );
        if (deal?.slots?.length) {
          setSelectedDeal(deal);
          setShowDealModal(true);
          return;
        }
      } catch {
        // Not a deal or API error — fall through to normal item
      }
    }
    const hasOptions = (item.variants && item.variants.length > 0) ||
      (item.addons && item.addons.length > 0) ||
      (item.modifier_groups && item.modifier_groups.length > 0);
    if (hasOptions) {
      setSelectedItemForConfig(item);
      setItemConfig({
        addons: [],
        modifiers: [],
        variantId: defaultVariantIdForItem(item),
      });
      setShowItemModal(true);
    } else {
      const newLine: CartLine = { menuItem: item, quantity: 1, addons: [], modifiers: [] };
      const idx = selectedItems.findIndex((existing) =>
        !existing.dealId && lineConfigMatch(
          { menu_item_id: item.id, variantId: undefined, addons: [], modifiers: [] },
          existing
        )
      );
      if (idx >= 0) {
        const updated = [...selectedItems];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
        setSelectedItems(updated);
      } else {
        setSelectedItems([...selectedItems, newLine]);
      }
      setJustAddedItem(item.id);
      setTimeout(() => setJustAddedItem(null), 500);
      toast.success(idx >= 0 ? `${item.name} quantity updated` : `${item.name} added to order`);
    }
  };

  const editCartLine = async (index: number) => {
    const line = selectedItems[index];
    if (!line) return;
    if (line.dealId != null && branchId != null) {
      try {
        const deal = await menuService.getDeal(
          line.dealId,
          branchId,
          effectiveOrderType ?? undefined,
        );
        if (deal?.slots?.length) {
          setEditingDealIndex(index);
          setDealInitialComponents(line.components ?? []);
          setSelectedDeal(deal);
          setShowDealModal(true);
          return;
        }
      } catch {
        // fall through
      }
    }
    // Non-deal line: open item config modal (if it has any options) or allow notes/variant/addons editing anyway.
    setEditingCartIndex(index);
    setSelectedItemForConfig(line.menuItem);
    setItemConfig({
      variantId: line.variantId,
      addons: line.addons ?? [],
      modifiers: line.modifiers ?? [],
      notes: line.notes,
    });
    setShowItemModal(true);
  };

  const handleDealConfirm = (params: {
    dealId: number;
    dealName: string;
    dealPrice: number;
    components: import('./components/types').DealComponentLine[];
  }) => {
    if (orderType == null || !orderTypeOptions.some((o) => o.value === orderType)) {
      toast.error('Select an order type before adding items');
      return;
    }
    const syntheticMenuItem: MenuItem = {
      id: params.dealId,
      name: params.dealName,
      base_price: params.dealPrice,
      category_id: 0,
      is_active: true,
      price: params.dealPrice,
      addons: [],
      variants: [],
    };
    const newLine: CartLine = {
      menuItem: syntheticMenuItem,
      quantity: 1,
      addons: [],
      modifiers: [],
      dealId: params.dealId,
      dealName: params.dealName,
      dealPrice: params.dealPrice,
      components: params.components,
    };
    setSelectedItems((prev) => {
      if (editingDealIndex != null && prev[editingDealIndex]) {
        const updated = [...prev];
        const keepQty = updated[editingDealIndex].quantity ?? 1;
        updated[editingDealIndex] = { ...newLine, quantity: keepQty };
        return updated;
      }
      return [...prev, newLine];
    });
    setJustAddedItem(params.dealId);
    setTimeout(() => setJustAddedItem(null), 500);
    toast.success(editingDealIndex != null ? `${params.dealName} updated` : `${params.dealName} added to order`);
    setShowDealModal(false);
    setSelectedDeal(null);
    setEditingDealIndex(null);
    setDealInitialComponents(null);
  };

  const confirmAddItem = () => {
    if (!selectedItemForConfig) return;
    if (orderType == null || !orderTypeOptions.some((o) => o.value === orderType)) {
      toast.error('Select an order type before adding items');
      return;
    }
    const groups = selectedItemForConfig.modifier_groups ?? [];
    // Conditional groups are only required when their trigger option is currently selected
    // (e.g. "Choose your Flavour" on the salad only applies once Peri Peri Chicken is picked).
    const selectedModifierIds = new Set(
      (itemConfig.modifiers ?? []).map(m => m.modifierId)
    );
    const isGroupVisible = (group: { visible_when_modifier_ids?: number[] | null }) => {
      const triggers = group.visible_when_modifier_ids;
      if (!triggers || triggers.length === 0) return true;
      return triggers.some(id => selectedModifierIds.has(id));
    };
    const configSizeKey = sizeKeyForSelection(selectedItemForConfig, itemConfig.variantId);
    for (const group of groups) {
      if (!isGroupVisible(group)) continue;
      const minSelect = resolveMinSelect(group, configSizeKey);
      const maxSelect = resolveMaxSelect(group, configSizeKey);
      const selectedInGroup = (itemConfig.modifiers ?? []).filter(m =>
        group.modifiers.some(mod => mod.id === m.modifierId)
      );
      const totalUnits = selectedInGroup.reduce((s, m) => s + (m.quantity || 1), 0);
      if (minSelect > 0 && totalUnits < minSelect) {
        toast.error(`Please select at least ${minSelect} for "${group.name}"`);
        return;
      }
      // Per-size caps can shrink after a size switch (XL 3 toppings → Large 2), so the
      // cap is re-checked here rather than only at selection time.
      if (maxSelect != null && totalUnits > maxSelect) {
        toast.error(`Please select at most ${maxSelect} for "${group.name}"`);
        return;
      }
    }
    const newLine = {
      menuItem: selectedItemForConfig,
      quantity: 1,
      variantId: itemConfig.variantId,
      addons: itemConfig.addons,
      modifiers: itemConfig.modifiers ?? [],
      notes: itemConfig.notes,
    };
    const toMatch = {
      menu_item_id: selectedItemForConfig.id,
      variantId: itemConfig.variantId,
      addons: itemConfig.addons,
      modifiers: itemConfig.modifiers ?? [],
      notes: itemConfig.notes,
    };
    if (editingCartIndex != null && selectedItems[editingCartIndex]) {
      const updated = [...selectedItems];
      const keepQty = updated[editingCartIndex].quantity ?? 1;
      updated[editingCartIndex] = { ...newLine, quantity: keepQty };
      setSelectedItems(updated);
      toast.success(`${selectedItemForConfig.name} updated`);
      setEditingCartIndex(null);
    } else {
      const idx = selectedItems.findIndex((existing) => lineConfigMatch(toMatch, existing));
      if (idx >= 0) {
        const updated = [...selectedItems];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
        setSelectedItems(updated);
        toast.success(`${selectedItemForConfig.name} quantity updated`);
      } else {
        setSelectedItems([...selectedItems, newLine]);
        toast.success(`${selectedItemForConfig.name} added to order`);
      }
    }
    setJustAddedItem(selectedItemForConfig.id);
    setTimeout(() => setJustAddedItem(null), 500);
    setShowItemModal(false);
    setSelectedItemForConfig(null);
    setItemConfig({ addons: [], modifiers: [] });
  };

  const toggleModifier = (modifierId: number) => {
    const existing = (itemConfig.modifiers ?? []).find((m) => m.modifierId === modifierId);
    const groupForModifier = selectedItemForConfig?.modifier_groups?.find((g) =>
      g.modifiers.some((m) => m.id === modifierId),
    );
    const currentInGroup = (itemConfig.modifiers ?? []).filter((m) => {
      const g = selectedItemForConfig?.modifier_groups?.find((gr) =>
        gr.modifiers.some((mod) => mod.id === m.modifierId),
      );
      return g?.id === groupForModifier?.id;
    });

    // If already selected, just unselect.
    if (existing) {
      setItemConfig({
        ...itemConfig,
        modifiers: (itemConfig.modifiers ?? []).filter((m) => m.modifierId !== modifierId),
      });
      return;
    }

    const toggleSizeKey = selectedItemForConfig
      ? sizeKeyForSelection(selectedItemForConfig, itemConfig.variantId)
      : null;
    // For single-select groups (min/max 1), behave like radio buttons:
    // clicking a new option unselects any previous one in this group and selects the new one.
    if (groupForModifier && (resolveMaxSelect(groupForModifier, toggleSizeKey) ?? 0) === 1) {
      const clearedOthers = (itemConfig.modifiers ?? []).filter((m) => {
        const g = selectedItemForConfig?.modifier_groups?.find((gr) =>
          gr.modifiers.some((mod) => mod.id === m.modifierId),
        );
        return g?.id !== groupForModifier.id;
      });
      setItemConfig({
        ...itemConfig,
        modifiers: [...clearedOthers, { modifierId, quantity: 1 }],
      });
      return;
    }

    // Multi-select groups: max_select bounds TOTAL UNITS (sum of quantities), so a
    // dip selected twice already fills a "choose 2" group.
    const unitsInGroup = currentInGroup.reduce((s, m) => s + (m.quantity || 1), 0);
    const maxUnits = groupForModifier ? resolveMaxSelect(groupForModifier, toggleSizeKey) || 99 : 99;
    if (groupForModifier && unitsInGroup >= maxUnits) {
      toast.error(`Maximum ${maxUnits} allowed for ${groupForModifier.name}`);
      return;
    }

    setItemConfig({
      ...itemConfig,
      modifiers: [...(itemConfig.modifiers ?? []), { modifierId, quantity: 1 }],
    });
  };

  const toggleAddon = (addonId: number) => {
    const existing = itemConfig.addons.find(a => a.addonId === addonId);
    if (existing) {
      setItemConfig({
        ...itemConfig,
        addons: itemConfig.addons.filter(a => a.addonId !== addonId),
      });
    } else {
      setItemConfig({
        ...itemConfig,
        addons: [...itemConfig.addons, { addonId, quantity: 1 }],
      });
    }
  };

  const updateAddonQuantity = (addonId: number, quantity: number) => {
    setItemConfig({
      ...itemConfig,
      addons: itemConfig.addons.map(a =>
        a.addonId === addonId ? { ...a, quantity } : a
      ),
    });
  };

  // Adjust how many of the same modifier are selected ("double meat" = quantity 2).
  // Quantity 0 removes the selection. The group's max_select caps TOTAL units across the
  // group, so increasing is clamped once the group is full. Backend prices extra units
  // per size after the group's free allowance is consumed.
  const updateModifierQuantity = (modifierId: number, quantity: number) => {
    let next = Math.max(0, Math.floor(quantity));
    const group = selectedItemForConfig?.modifier_groups?.find((g) =>
      g.modifiers.some((m) => m.id === modifierId),
    );
    if (group && next > 0) {
      const qtySizeKey = selectedItemForConfig
        ? sizeKeyForSelection(selectedItemForConfig, itemConfig.variantId)
        : null;
      const max = resolveMaxSelect(group, qtySizeKey) ?? 99;
      const otherUnits = (itemConfig.modifiers ?? [])
        .filter((m) => m.modifierId !== modifierId && group.modifiers.some((mod) => mod.id === m.modifierId))
        .reduce((s, m) => s + (m.quantity || 1), 0);
      next = Math.min(next, Math.max(0, max - otherUnits));
    }
    setItemConfig({
      ...itemConfig,
      modifiers: (itemConfig.modifiers ?? [])
        .map((m) => (m.modifierId === modifierId ? { ...m, quantity: next } : m))
        .filter((m) => m.quantity > 0),
    });
  };

  const removeItem = (index: number) => {
    setSelectedItems(selectedItems.filter((_, i) => i !== index));
  };

  const updateQuantity = (index: number, quantity: number) => {
    const updated = [...selectedItems];
    updated[index].quantity = quantity;
    setSelectedItems(updated);
  };

  const handleCreateOrder = () => {
    if (effectiveOrderType == null) {
      toast.error('Select an order type before checkout');
      return;
    }
    if (selectedItems.length === 0) {
      toast.error('Please add items to the order');
      return;
    }
    // Customer requirements depend on order type: dine-in is fully optional;
    // takeaway & delivery require a name + phone (delivery also needs an address).
    const customerRequired =
      effectiveOrderType === 'takeaway' || effectiveOrderType === 'delivery';
    if (customerRequired) {
      if (!customerName.trim()) {
        toast.error('Customer name is required for takeaway and delivery orders');
        return;
      }
      if (!customerPhone.trim()) {
        toast.error('Customer phone is required (Pakistani format: 03XXXXXXXXX)');
        return;
      }
    }
    // Validate the phone format whenever one was entered (required above, or
    // optionally typed for a dine-in order).
    if (customerPhone.trim()) {
      try {
        validatePakistaniPhone(customerPhone.trim());
      } catch {
        setPhoneError('Use format 03XXXXXXXXX (e.g. 03001234567)');
        toast.error('Invalid Pakistani phone number');
        return;
      }
    }
    setPhoneError('');
    if (effectiveOrderType === 'delivery' && !deliveryAddress.trim()) {
      toast.error('Delivery address is required for delivery orders');
      return;
    }
    if (effectiveOrderType === 'dine_in' && !tableNumber.trim()) {
      toast.error('Please enter a table number for dine-in orders');
      return;
    }
    if (!branchId) {
      toast.error('No branch assigned. Ask an admin to assign you to a branch in Branch Users.');
      return;
    }
    if (!openShift) {
      toast.error('No shift is open for this branch. Open a shift in Admin → Shifts before placing orders.');
      return;
    }
    const orderTotal = Number(quote?.total_amount ?? total ?? 0);
    if (orderTotal <= 0) {
      toast.error('Order total must be greater than zero');
      return;
    }
    const payments: Array<{ method: 'cash' | 'card'; amount: number }> = [];
    if (paymentMode === 'cash') {
      payments.push({ method: 'cash', amount: orderTotal });
    } else if (paymentMode === 'card') {
      payments.push({ method: 'card', amount: orderTotal });
    } else {
      const cash = parseFloat(paymentCashAmount || '0') || 0;
      const card = parseFloat(paymentCardAmount || '0') || 0;
      const sum = Math.round((cash + card) * 100) / 100;
      if (Math.abs(sum - orderTotal) > 0.01) {
        toast.error(`Cash + Card (${formatCurrency(sum)}) must equal total (${formatCurrency(orderTotal)})`);
        return;
      }
      if (cash > 0) payments.push({ method: 'cash', amount: cash });
      if (card > 0) payments.push({ method: 'card', amount: card });
    }
    if (payments.length === 0) {
      toast.error('Please select payment method and ensure payment covers the total');
      return;
    }
    const payload: CreateOrderRequest = {
      branch_id: branchId,
      order_type: effectiveOrderType,
      // Tender split so the persisted GST matches the tender the customer actually pays with.
      payment_split: paymentSplit,
      bank_card_id: paymentMode === 'card' ? bankCardId : null,
      table_number: effectiveOrderType === 'dine_in' ? tableNumber : undefined,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      delivery_address: effectiveOrderType === 'delivery' ? deliveryAddress.trim() : undefined,
      discount_code: discountCode.trim() || undefined,
      loyalty_points_to_redeem: typeof loyaltyPointsToRedeem === 'number' && loyaltyPointsToRedeem > 0 ? loyaltyPointsToRedeem : undefined,
      items: selectedItems.map((item) => {
        if (item.dealId != null && item.components?.length) {
          return {
            deal_menu_item_id: item.dealId,
            quantity: item.quantity,
            components: item.components.map((c) => ({
              slot_index: c.slot_index ?? 0,
              menu_item_id: c.menuItem.id,
              quantity: c.quantity,
              variant_id: c.variantId,
              addons: c.addons.map((a) => ({ addon_id: a.addonId, quantity: a.quantity })),
              modifiers: c.modifiers?.length ? c.modifiers.map((m) => ({ modifier_id: m.modifierId, quantity: m.quantity })) : undefined,
              notes: c.notes,
            })),
          };
        }
        return {
          menu_item_id: item.menuItem.id,
          quantity: item.quantity,
          variant_id: item.variantId,
          addons: item.addons.map((a) => ({ addon_id: a.addonId, quantity: a.quantity })),
          modifiers: item.modifiers?.length ? item.modifiers.map((m) => ({ modifier_id: m.modifierId, quantity: m.quantity })) : undefined,
          notes: item.notes,
        };
      }),
      notes: orderNotes.trim() || undefined,
    };
    createOrderMutation.mutate({ order: payload, payments });
  };

  /** Build editable cart lines from a stored kiosk payload, resolving against the loaded branch menu. */
  const buildCartLinesFromKioskPayload = (
    items: CreateOrderRequest['items'],
    menuMap: Map<number, MenuItem>,
  ): CartLine[] => {
    const lines: CartLine[] = [];
    for (const it of items ?? []) {
      if ('deal_menu_item_id' in it && it.deal_menu_item_id != null) {
        const dealItem = menuMap.get(it.deal_menu_item_id);
        if (!dealItem) continue;
        const components = (it.components ?? [])
          .map((c): DealComponentLine | null => {
            const cm = menuMap.get(c.menu_item_id);
            if (!cm) return null;
            return {
              menuItem: cm,
              quantity: c.quantity,
              slot_index: c.slot_index,
              variantId: c.variant_id,
              addons: (c.addons ?? []).map((a) => ({ addonId: a.addon_id, quantity: a.quantity ?? 1 })),
              modifiers: (c.modifiers ?? []).map((m) => ({ modifierId: m.modifier_id, quantity: m.quantity ?? 1 })),
              notes: c.notes,
            };
          })
          .filter((c): c is DealComponentLine => c != null);
        if (components.length === 0) continue;
        // A BOGO deal's bundle price is dynamic (full + cheaper-at-half of its pizzas), not the
        // deal root's base_price (which is 0). Recompute it from the restored components so the
        // line total displays correctly; the server still reprices authoritatively.
        const dealPrice =
          dealItem.deal_pricing_mode === 'bogo'
            ? bogoDealTotal(
                components.map(
                  (c) =>
                    (c.menuItem.price ?? c.menuItem.base_price ?? 0) +
                    (c.menuItem.variants?.find((v) => v.id === c.variantId)
                      ?.price_modifier ?? 0),
                ),
                1,
                1,
                Number(dealItem.bogo_get_percent ?? 0),
              )
            : dealItem.price ?? dealItem.base_price ?? 0;
        lines.push({
          menuItem: dealItem,
          quantity: it.quantity,
          addons: [],
          modifiers: [],
          dealId: it.deal_menu_item_id,
          dealName: dealItem.name,
          dealPrice,
          components,
        });
      } else if ('menu_item_id' in it && it.menu_item_id != null) {
        const mi = menuMap.get(it.menu_item_id);
        if (!mi) continue;
        lines.push({
          menuItem: mi,
          quantity: it.quantity,
          variantId: it.variant_id,
          addons: (it.addons ?? []).map((a) => ({ addonId: a.addon_id, quantity: a.quantity ?? 1 })),
          modifiers: (it.modifiers ?? []).map((m) => ({ modifierId: m.modifier_id, quantity: m.quantity ?? 1 })),
          notes: it.notes,
        });
      }
    }
    return lines;
  };

  /** Cashier loads a pending kiosk cart by its code into the editable POS cart. */
  const loadKioskOrder = async () => {
    const code = kioskCodeInput.trim();
    if (!code) {
      toast.error('Enter a kiosk order number');
      return;
    }
    if (effectiveBranchId == null) {
      toast.error('Select a branch first');
      return;
    }
    setKioskLoading(true);
    try {
      const data = await orderService.lookupKioskOrder(code, effectiveBranchId);
      const menuMap = new Map<number, MenuItem>();
      (rawMenu as MenuItem[]).forEach((m) => menuMap.set(m.id, m));
      const cartLines = buildCartLinesFromKioskPayload(data.payload?.items ?? data.items ?? [], menuMap);
      if (cartLines.length === 0) {
        toast.error('None of this kiosk order’s items are on the current branch menu.');
        return;
      }
      setCustomerName(data.customer_name ?? '');
      setCustomerPhone(data.customer_phone ?? '');
      setDiscountCode(data.payload?.discount_code ?? '');
      setOrderNotes(data.payload?.notes ?? '');
      setOrderType(data.order_type as OrderTypeOption);
      setPendingKioskCart(cartLines);
      setActiveKioskCode(data.kiosk_code);
      setKioskInfo({
        price_changed: data.price_changed,
        items_dropped: data.items_dropped,
        snapshot_total: data.snapshot_total,
        current_total: data.current_total,
      });
      setShowKioskModal(false);
      setKioskCodeInput('');
      if (data.items_dropped) toast('Some items are no longer available and were skipped.', { icon: <MdOutlineWarningAmber /> });
      if (data.price_changed) toast('Prices changed since the customer ordered — review the new total.', { icon: <MdOutlineWarningAmber /> });
      toast.success(`Loaded kiosk order #${data.kiosk_code}`);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Kiosk order not found');
    } finally {
      setKioskLoading(false);
    }
  };

  /** Unlink the current order from its kiosk code (and clear the loaded cart). */
  const clearKioskOrder = () => {
    setActiveKioskCode(null);
    setKioskInfo(null);
    setSelectedItems([]);
  };

  /** Place a loaded kiosk cart — like handleCreateOrder, but customer name/phone are optional. */
  const handleFinalizeKiosk = () => {
    if (!activeKioskCode) return;
    if (effectiveOrderType == null) {
      toast.error('Select an order type before checkout');
      return;
    }
    if (selectedItems.length === 0) {
      toast.error('Please add items to the order');
      return;
    }
    if (!branchId) {
      toast.error('No branch assigned. Ask an admin to assign you to a branch in Branch Users.');
      return;
    }
    if (!openShift) {
      toast.error('No shift is open for this branch. Open a shift in Admin → Shifts before placing orders.');
      return;
    }
    if (customerPhone.trim()) {
      try {
        validatePakistaniPhone(customerPhone.trim());
      } catch {
        setPhoneError('Use format 03XXXXXXXXX (e.g. 03001234567)');
        toast.error('Invalid Pakistani phone number');
        return;
      }
    }
    setPhoneError('');
    if (effectiveOrderType === 'dine_in' && !tableNumber.trim()) {
      toast.error('Please enter a table number for dine-in orders');
      return;
    }
    const orderTotal = Number(quote?.total_amount ?? total ?? 0);
    if (orderTotal <= 0) {
      toast.error('Order total must be greater than zero');
      return;
    }
    const payments: Array<{ method: 'cash' | 'card'; amount: number }> = [];
    if (paymentMode === 'cash') {
      payments.push({ method: 'cash', amount: orderTotal });
    } else if (paymentMode === 'card') {
      payments.push({ method: 'card', amount: orderTotal });
    } else {
      const cash = parseFloat(paymentCashAmount || '0') || 0;
      const card = parseFloat(paymentCardAmount || '0') || 0;
      const sum = Math.round((cash + card) * 100) / 100;
      if (Math.abs(sum - orderTotal) > 0.01) {
        toast.error(`Cash + Card (${formatCurrency(sum)}) must equal total (${formatCurrency(orderTotal)})`);
        return;
      }
      if (cash > 0) payments.push({ method: 'cash', amount: cash });
      if (card > 0) payments.push({ method: 'card', amount: card });
    }
    if (payments.length === 0) {
      toast.error('Please select payment method and ensure payment covers the total');
      return;
    }
    const order: CreateOrderRequest = {
      branch_id: branchId,
      order_type: effectiveOrderType,
      // The card the cashier is charging: without it a kiosk cart would finalize
      // at full price even though the same order rung up here gets the card offer.
      // The tender split is derived server-side from `payments`, not sent.
      bank_card_id: paymentMode === 'card' ? bankCardId : null,
      table_number: effectiveOrderType === 'dine_in' ? tableNumber : undefined,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      discount_code: discountCode.trim() || undefined,
      items: selectedItems.map((item) => {
        if (item.dealId != null && item.components?.length) {
          return {
            deal_menu_item_id: item.dealId,
            quantity: item.quantity,
            components: item.components.map((c) => ({
              slot_index: c.slot_index ?? 0,
              menu_item_id: c.menuItem.id,
              quantity: c.quantity,
              variant_id: c.variantId,
              addons: c.addons.map((a) => ({ addon_id: a.addonId, quantity: a.quantity })),
              modifiers: c.modifiers?.length ? c.modifiers.map((m) => ({ modifier_id: m.modifierId, quantity: m.quantity })) : undefined,
              notes: c.notes,
            })),
          };
        }
        return {
          menu_item_id: item.menuItem.id,
          quantity: item.quantity,
          variant_id: item.variantId,
          addons: item.addons.map((a) => ({ addon_id: a.addonId, quantity: a.quantity })),
          modifiers: item.modifiers?.length ? item.modifiers.map((m) => ({ modifier_id: m.modifierId, quantity: m.quantity })) : undefined,
          notes: item.notes,
        };
      }),
      notes: orderNotes.trim() || undefined,
    };
    finalizeKioskMutation.mutate({ code: activeKioskCode, body: { branch_id: branchId, order, payments } });
  };

  const total = selectedItems.reduce((sum, item) => {
    if (item.dealPrice != null && item.components?.length) {
      const componentExtras = item.components.reduce((s, c) => {
        const addonsPrice = (c.addons ?? []).reduce((aSum, a) => {
          const addonItem = c.menuItem.addons?.find(ad => ad.id === a.addonId);
          return aSum + (addonItem?.price || 0) * a.quantity;
        }, 0);
        const modifiersPrice = computeModifiersPrice(
          c.menuItem.modifier_groups,
          c.modifiers,
          sizeKeyForSelection(c.menuItem, c.variantId),
        );
        return s + addonsPrice + modifiersPrice;
      }, 0);
      return sum + (item.dealPrice + componentExtras) * item.quantity;
    }
    if (item.dealPrice != null) {
      return sum + item.dealPrice * item.quantity;
    }
    const basePrice = item.menuItem.price || item.menuItem.base_price || 0;
    const variantPrice = item.variantId && item.menuItem.variants
      ? item.menuItem.variants.find(v => v.id === item.variantId)?.price_modifier || 0
      : 0;
    const addonsPrice = item.addons.reduce((addonSum, addon) => {
      const addonItem = item.menuItem.addons?.find(a => a.id === addon.addonId);
      return addonSum + (addonItem?.price || 0) * addon.quantity;
    }, 0);
    const modifiersPrice = computeModifiersPrice(
      item.menuItem.modifier_groups,
      item.modifiers,
      sizeKeyForSelection(item.menuItem, item.variantId),
    );
    return sum + (basePrice + variantPrice + addonsPrice + modifiersPrice) * item.quantity;
  }, 0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = document.activeElement;
      const isInput = target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement);
      if (e.key === '/') {
        if (!isInput) {
          e.preventDefault();
          (searchInputRefDesktop.current ?? searchInputRefMobile.current)?.focus();
        }
        return;
      }
      if (e.key === 'Escape') {
        setShowItemModal(false);
        setSelectedItemForConfig(null);
        setItemConfig({ addons: [], modifiers: [] });
        setShowDealModal(false);
        setSelectedDeal(null);
        setShowAddCustomerModal(false);
        setShowCustomerInvoiceModal(false);
        setShowCheckoutModal(false);
        setDrawerOpen(false);
        return;
      }
      if (e.key === 'Enter' && e.ctrlKey) {
        if (!isInput) {
          e.preventDefault();
          if (!showCheckoutModal && selectedItems.length > 0 && effectiveOrderType != null) {
            setShowCheckoutModal(true);
            setDrawerOpen(false);
          } else {
            handleCreateOrder();
          }
        }
        return;
      }
      if (e.key === 'Enter' && !e.ctrlKey && !isInput) {
        if (menuFilteredBySearch?.length > 0) {
          e.preventDefault();
          addItem(menuFilteredBySearch[0]);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addItem, handleCreateOrder, menuFilteredBySearch, showCheckoutModal, selectedItems.length, effectiveOrderType]);

  if (loadingBranches) {
    return <Loader fullScreen text="Loading..." />;
  }

  if (posBranches && posBranches.length === 0) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center bg-foodies-surfaceMuted dark:bg-slate-900 px-6 pt-16 pb-12 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-foodies-primary/10 text-foodies-primary ring-1 ring-foodies-primary/20">
          <MdOutlineSchedule className="h-10 w-10" />
        </div>
        <h2 className="mt-6 text-2xl font-bold text-foodies-textPrimary dark:text-slate-100">
          No branch is open for POS
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-foodies-textSecondary dark:text-slate-400">
          No branch has an open shift yet. Open a shift to start taking orders. If you’re not a
          super admin, make sure you’re assigned to a branch in Admin → Branch Users.
        </p>

        <Link to="/admin/shifts" className="mt-8 w-full max-w-xs">
          <Button variant="gradient" className="w-full rounded-xl py-3 font-semibold">
            Open a shift
          </Button>
        </Link>
      </div>
    );
  }

  if (effectiveBranchId != null && isLoading) {
    return <Loader fullScreen text="Loading menu..." />;
  }

  const isSubmitting = createOrderMutation.isPending || finalizeKioskMutation.isPending || addCustomerMutation.isPending;
  if (isSubmitting) {
    return <Loader fullScreen text="Submitting..." />;
  }

  const filtersProps = {
    brands,
    selectedBrandId,
    onBrandChange: (id: number | null) => {
      setSelectedBrandId(id);
      setSelectedCategoryId(null);
    },
    categories: categoriesFromMenu,
    selectedCategoryId,
    onCategoryChange: setSelectedCategoryId,
    effectiveBranchId,
    posBranches,
    onBranchChange: (id: number | null) => {
      setSelectedBranchId(id);
      setSelectedItems([]);
      setSelectedBrandId(null);
      setSelectedCategoryId(null);
      setOrderType(null);
    },
    openShift,
    branchId,
    search: posSearch,
    onSearchChange: setPosSearch,
    searchSuggestions: posSearchTypeahead.suggestions,
    searchSuggestionsOpen: posSearchTypeahead.open,
    setSearchSuggestionsOpen: posSearchTypeahead.setOpen,
    searchSuggestionsActiveIndex: posSearchTypeahead.activeIndex,
    setSearchSuggestionsActiveIndex: posSearchTypeahead.setActiveIndex,
    onPickSearchSuggestion: (label: string) => setPosSearch(label),
    orderTypeOptions,
    orderType,
    onOrderTypeChange: handleOrderTypeChange,
  };

  if (effectiveBranchId != null && branchId != null && !openShift) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center bg-foodies-surfaceMuted dark:bg-slate-900 px-6 pt-16 pb-12 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-foodies-primary/10 text-foodies-primary ring-1 ring-foodies-primary/20">
          <MdOutlineSchedule className="h-10 w-10" />
        </div>
        <h2 className="mt-6 text-2xl font-bold text-foodies-textPrimary dark:text-slate-100">
          No shift open for this branch
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-foodies-textSecondary dark:text-slate-400">
          Open a shift before taking orders. Only one shift can be open per branch at a time.
        </p>

        <Link to="/admin/shifts" className="mt-8 w-full max-w-xs">
          <Button variant="gradient" className="w-full rounded-xl py-3 font-semibold">
            Open a shift
          </Button>
        </Link>

        {(posBranches?.length ?? 0) > 1 && (
          <div className="mt-8 w-full max-w-xs">
            <div className="mb-3 flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-foodies-textSecondary dark:text-slate-500">
              <span className="h-px flex-1 bg-foodies-border dark:bg-slate-700" />
              or switch branch
              <span className="h-px flex-1 bg-foodies-border dark:bg-slate-700" />
            </div>
            <SearchableSelect
              value={effectiveBranchId != null ? String(effectiveBranchId) : ''}
              onChange={(v) => filtersProps.onBranchChange(v === '' ? null : Number(v))}
              options={(posBranches ?? []).map((b) => ({
                value: String(b.id),
                label: `${b.name} (${b.code})`,
              }))}
              placeholder="Select branch"
              className="w-full"
            />
          </div>
        )}
      </div>
    );
  }

  if (rawMenu.length === 0) {
    const branchInactive = branchMenu?.branch_active === false;
    return (
      <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center bg-foodies-surfaceMuted dark:bg-slate-900 px-6 pt-16 pb-12 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-foodies-primary/10 text-foodies-primary ring-1 ring-foodies-primary/20">
          {branchInactive ? (
            <MdOutlineStorefront className="h-10 w-10" />
          ) : (
            <MdOutlineRestaurantMenu className="h-10 w-10" />
          )}
        </div>
        <h2 className="mt-6 text-2xl font-bold text-foodies-textPrimary dark:text-slate-100">
          {branchInactive ? 'This branch is inactive' : 'No menu items for this branch'}
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-foodies-textSecondary dark:text-slate-400">
          {branchInactive
            ? 'This branch is currently marked inactive, so it takes no orders. Reactivate it before taking orders, or switch to another branch.'
            : 'No menu items are linked to this branch yet. Link items from its brands before taking orders, or switch to another branch.'}
        </p>

        <Link
          to={branchInactive ? '/admin/branches' : `/admin/branches/${effectiveBranchId}`}
          className="mt-8 w-full max-w-xs"
        >
          <Button variant="gradient" className="w-full rounded-xl py-3 font-semibold">
            {branchInactive ? 'Manage branches' : 'Link menu items'}
          </Button>
        </Link>

        {(posBranches?.length ?? 0) > 1 && (
          <div className="mt-8 w-full max-w-xs">
            <div className="mb-3 flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-foodies-textSecondary dark:text-slate-500">
              <span className="h-px flex-1 bg-foodies-border dark:bg-slate-700" />
              or switch branch
              <span className="h-px flex-1 bg-foodies-border dark:bg-slate-700" />
            </div>
            <SearchableSelect
              value={effectiveBranchId != null ? String(effectiveBranchId) : ''}
              onChange={(v) => filtersProps.onBranchChange(v === '' ? null : Number(v))}
              options={(posBranches ?? []).map((b) => ({
                value: String(b.id),
                label: `${b.name} (${b.code})`,
              }))}
              placeholder="Select branch"
              className="w-full"
            />
          </div>
        )}
      </div>
    );
  }

  if (effectiveOrderType != null && menuAll.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] bg-foodies-surfaceMuted dark:bg-slate-900 p-6">
        <Card className="w-full max-w-md">
          <div className="mb-4">
            <POSFilters {...filtersProps} />
          </div>
          <div className="text-center py-8">
            <h2 className="text-2xl font-bold text-foodies-textPrimary dark:text-slate-100 mb-2">No menu items for this order type</h2>
            <p className="text-foodies-textSecondary dark:text-slate-400">
              No items are configured for {orderTypeOptions.find((o) => o.value === effectiveOrderType)?.label ?? effectiveOrderType} at this branch. Try another order type or add availability in Admin → Menu Items.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const checkoutSectionContent = (
      <>
        <div className="flex-shrink-0 px-6 py-4 bg-foodies-surface dark:bg-slate-800 border-b border-foodies-border dark:border-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-foodies-textPrimary dark:text-slate-100 tracking-tight">Cart</h2>
              <p className="text-sm text-foodies-textSecondary dark:text-slate-400 mt-0.5">Review items here, then checkout</p>
            </div>
            <Button
              variant="outline"
              size="small"
              className="flex-shrink-0 whitespace-nowrap"
              onClick={() => { setKioskCodeInput(''); setShowKioskModal(true); }}
            >
              Load Kiosk Order
            </Button>
          </div>
          {activeKioskCode && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-foodies-primary/10 border border-foodies-primary/30 px-3 py-2">
              <span className="text-sm font-semibold text-foodies-primary">Kiosk #{activeKioskCode}</span>
              <button
                type="button"
                onClick={clearKioskOrder}
                className="text-xs font-medium text-foodies-textSecondary hover:text-foodies-textPrimary"
              >
                Clear <MdClose className="inline h-4 w-4" />
              </button>
            </div>
          )}
          {activeKioskCode && kioskInfo?.price_changed && (
            <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
              <MdOutlineWarningAmber className="inline h-4 w-4 mr-1 align-text-bottom" /> Prices changed since the customer ordered — collect the updated total ({formatCurrency(kioskInfo.current_total)}).
            </p>
          )}
          {activeKioskCode && kioskInfo?.items_dropped && (
            <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
              <MdOutlineWarningAmber className="inline h-4 w-4 mr-1 align-text-bottom" /> Some items were no longer available and were skipped.
            </p>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          <CartPanel
            items={selectedItems}
            onUpdateQuantity={updateQuantity}
            onRemoveItem={removeItem}
            onRequestRemoveItem={setRemoveConfirmIndex}
            onConfigureItem={editCartLine}
            getBrandName={getBrandName}
            lineBreakdown={quote?.line_breakdown ?? undefined}
          />
        </div>
        <div className="flex-shrink-0 p-6 border-t border-foodies-border dark:border-slate-700 bg-foodies-surface dark:bg-slate-800">
          {renderTenderPreview()}
          <div className="flex items-center justify-between text-sm text-foodies-textSecondary dark:text-slate-400">
            <span>Total</span>
            <span className="font-bold text-foodies-textPrimary dark:text-slate-100">{formatCurrency(quote?.total_amount ?? total)}</span>
          </div>
          <Button
            variant="gradient"
            className="w-full mt-3 font-semibold py-3 rounded-xl"
            size="large"
            disabled={selectedItems.length === 0 || effectiveOrderType == null}
            onClick={() => {
              setShowCheckoutModal(true);
              setDrawerOpen(false);
            }}
          >
            Checkout
          </Button>
          <p className="mt-2 text-xs text-foodies-textSecondary">
            Checkout to select customer, apply discount/loyalty, and take payment.
          </p>
        </div>
      </>
    );

  const isSubmittingOrder = activeKioskCode
    ? finalizeKioskMutation.isPending
    : createOrderMutation.isPending;
  /**
   * A kiosk cart's order type was the customer's own choice, and handleFinalizeKiosk
   * never sends a delivery address — so switching one to Delivery here would save an
   * address-less delivery order. Keep the row read-only for kiosk carts.
   */
  const orderTypeLocked = activeKioskCode != null;

  return (
    <>
      <POSLayout
        centerSection={
          <>
            {/* Order type — full-width screen-mode tab strip (its own row, the
                primary control), with the menu filters demoted to a quieter
                row below. */}
            <OrderTypeSelector
              options={orderTypeOptions}
              value={effectiveOrderType}
              onChange={handleOrderTypeChange}
            />
            <div className="flex-shrink-0 px-4 py-3 bg-foodies-surface border-b border-foodies-border dark:bg-slate-800 dark:border-slate-700">
              <div className="lg:hidden">
                <POSFilters
                  {...filtersProps}
                  showOrderType={false}
                  showHint={false}
                  variant="bar"
                  searchInputRef={searchInputRefMobile}
                />
              </div>
              <div className="hidden lg:block">
                <POSFilters
                  {...filtersProps}
                  showOrderType={false}
                  showHint={false}
                  variant="bar"
                  searchInputRef={searchInputRefDesktop}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {/* <RiderTrackingTestPanel /> */}
              <MenuGrid
                menu={paginatedMenu}
                justAddedItemId={justAddedItem}
                onAddItem={addItem}
                getBrandName={getBrandName}
                totalCount={menuFilteredBySearch.length}
                page={currentMenuPage}
                pageSize={MENU_PAGE_SIZE}
                onPageChange={setCurrentMenuPage}
              />
            </div>
          </>
        }
        checkoutSection={checkoutSectionContent}
        cartItemCount={selectedItems.length}
        isDrawerOpen={drawerOpen}
        onDrawerOpen={() => setDrawerOpen(true)}
        onDrawerClose={() => setDrawerOpen(false)}
      />

      <CustomerInvoiceModal
        isOpen={showCustomerInvoiceModal}
        onClose={() => setShowCustomerInvoiceModal(false)}
        orderGroupId={lastOrderGroupId}
      />

      {/* Checkout modal (customer, discounts/loyalty, payment) */}
      <Modal
        isOpen={showCheckoutModal}
        onClose={() => setShowCheckoutModal(false)}
        title="Checkout"
        size="large"
      >
        <div className="max-h-[75vh] overflow-y-auto space-y-6 p-1">
          <div className="rounded-xl border border-foodies-border bg-foodies-surface p-4">
            <div className="flex items-center justify-between text-sm text-foodies-textSecondary">
              <span>Items</span>
              <span className="font-semibold text-foodies-textPrimary">{selectedItems.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-foodies-textSecondary mt-2">
              <span>Total</span>
              <span className="font-bold text-foodies-textPrimary">{formatCurrency(quote?.total_amount ?? total)}</span>
            </div>
            <div className="mt-2">{renderTenderPreview()}</div>
            {effectiveOrderType != null && (
              <div className="mt-2 pt-2 border-t border-foodies-border/60">
                <div className="flex items-center justify-between text-sm text-foodies-textSecondary">
                  <span>Order type</span>
                  {orderTypeLocked && (
                    <span className="font-semibold text-foodies-textPrimary">
                      {orderTypeOptions.find((o) => o.value === effectiveOrderType)?.label ?? effectiveOrderType}
                    </span>
                  )}
                </div>
                {/* Switching here runs the same guard as the main tab strip: lines the
                    new channel can't fulfil raise the confirm modal below, and the
                    quote re-prices off the changed payload. */}
                {!orderTypeLocked && (
                  <div role="radiogroup" aria-label="Order type" className="mt-2 flex gap-1 rounded-lg bg-foodies-bg dark:bg-slate-900 p-1">
                    {orderTypeOptions.map((opt) => {
                      const selected = opt.value === effectiveOrderType;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={isSubmittingOrder}
                          onClick={() => handleOrderTypeChange(opt.value)}
                          className={`flex-1 rounded-md px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                            selected
                              ? 'bg-foodies-primary/10 font-bold text-foodies-primary shadow-sm'
                              : 'font-semibold text-foodies-textSecondary hover:text-foodies-textPrimary'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-foodies-border dark:border-slate-600 bg-foodies-surface dark:bg-slate-800 p-4">
            <h3 className="text-sm font-semibold text-foodies-textPrimary dark:text-slate-100 mb-3">Customer &amp; details</h3>
            <CustomerPanel
              orderType={effectiveOrderType!}
              tableNumber={tableNumber}
              onTableNumberChange={setTableNumber}
              customerName={customerName}
              customerPhone={customerPhone}
              onCustomerChange={({ name, phone }) => {
                setCustomerName(name);
                setCustomerPhone(phone);
                setPhoneError('');
              }}
              phoneError={phoneError}
              onAddCustomerClick={(query) => {
                // Prefill the new-customer form with whatever was typed in the
                // search box — a phone-like value (mostly digits) goes to phone,
                // anything else to name.
                const q = (query ?? '').trim();
                if (q && /^[\d\s()+-]{4,}$/.test(q)) {
                  setAddCustomerPhone(q);
                  setAddCustomerName('');
                } else {
                  setAddCustomerName(q);
                  setAddCustomerPhone('');
                }
                setAddCustomerPhoneError('');
                setShowAddCustomerModal(true);
              }}
              loyaltyBalance={loyaltyBalance}
              deliveryAddress={deliveryAddress}
              onDeliveryAddressChange={setDeliveryAddress}
              loyaltyPointsToRedeem={loyaltyPointsToRedeem}
              onLoyaltyPointsToRedeemChange={setLoyaltyPointsToRedeem}
              discountCode={discountCode}
              onDiscountCodeChange={setDiscountCode}
              orderNotes={orderNotes}
              onOrderNotesChange={setOrderNotes}
              quote={quote}
            />
          </div>

          <div className="rounded-xl border border-foodies-border dark:border-slate-600 bg-foodies-surface dark:bg-slate-800 p-4">
            <h3 className="text-sm font-semibold text-foodies-textPrimary dark:text-slate-100 mb-3">Payment</h3>
            <PaymentPanel
              subtotal={total}
              quote={quote}
              paymentMode={paymentMode}
              onPaymentModeChange={setPaymentMode}
              paymentCashAmount={paymentCashAmount}
              paymentCardAmount={paymentCardAmount}
              onPaymentCashAmountChange={setPaymentCashAmount}
              onPaymentCardAmountChange={setPaymentCardAmount}
              bankCards={bankCards ?? []}
              bankCardId={bankCardId}
              onBankCardChange={setBankCardId}
              onCreateOrder={activeKioskCode ? handleFinalizeKiosk : handleCreateOrder}
              isSubmitting={isSubmittingOrder}
              itemCount={selectedItems.length}
            />
            <div className="flex justify-end mt-3">
              <Button variant="outline" onClick={() => setShowCheckoutModal(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Load kiosk "pay at counter" order by code */}
      <Modal
        isOpen={showKioskModal}
        onClose={() => setShowKioskModal(false)}
        title="Load Kiosk Order"
      >
        <div className="space-y-4 p-1">
          <p className="text-sm text-foodies-textSecondary dark:text-slate-400">
            Enter the order number the customer received at the kiosk. The cart will load here so you can review it, take payment, and place the order.
          </p>
          <div>
            <label className="block text-sm font-medium text-foodies-textPrimary dark:text-slate-100 mb-1">Kiosk order number</label>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={kioskCodeInput}
              onChange={(e) => setKioskCodeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadKioskOrder(); }}
              placeholder="e.g. 001"
              className="w-full rounded-lg border border-foodies-border dark:border-slate-600 bg-foodies-surface dark:bg-slate-800 px-3 py-2 text-foodies-textPrimary dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-foodies-primary/40"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowKioskModal(false)}>Cancel</Button>
            <Button variant="gradient" onClick={loadKioskOrder} disabled={kioskLoading}>
              {kioskLoading ? 'Loading…' : 'Load Order'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Order-type switch: warn about items the new channel can't fulfil.
          Must stay BELOW the Checkout modal: the order type is switchable from
          inside Checkout, and Modal paints siblings at the same z-index, so a
          confirm rendered earlier would open behind Checkout and soft-lock it. */}
      <Modal
        isOpen={pendingOrderTypeChange !== null}
        onClose={() => setPendingOrderTypeChange(null)}
        title="Some items aren't available"
      >
        <div className="space-y-4">
          <p className="text-foodies-textPrimary">
            {pendingOrderTypeChange && (
              <>
                {pendingOrderTypeChange.removable.length === selectedItems.length
                  ? 'None of the items in your cart are available for '
                  : 'These items aren’t available for '}
                <strong>
                  {orderTypeOptions.find((o) => o.value === pendingOrderTypeChange.next)?.label ??
                    pendingOrderTypeChange.next}
                </strong>{' '}
                and will be removed from the cart:
              </>
            )}
          </p>
          {pendingOrderTypeChange && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-foodies-textSecondary dark:text-slate-400">
              {pendingOrderTypeChange.removable.map((line, i) => (
                <li key={i}>
                  {(line.dealName ?? line.menuItem.name) || 'Item'}
                  {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPendingOrderTypeChange(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmOrderTypeChange}>
              Remove &amp; switch
            </Button>
          </div>
        </div>
      </Modal>

      {/* Remove item from cart confirmation */}
      <Modal
        isOpen={removeConfirmIndex !== null}
        onClose={() => setRemoveConfirmIndex(null)}
        title="Remove item?"
      >
        <div className="space-y-4">
          <p className="text-foodies-textPrimary">
            {removeConfirmIndex !== null && selectedItems[removeConfirmIndex] && (
              <>Remove &ldquo;{selectedItems[removeConfirmIndex].menuItem.name}&rdquo; from the order?</>
            )}
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setRemoveConfirmIndex(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (removeConfirmIndex !== null) {
                  removeItem(removeConfirmIndex);
                  setRemoveConfirmIndex(null);
                }
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add customer modal */}
      <Modal
        isOpen={showAddCustomerModal}
        onClose={() => {
          setShowAddCustomerModal(false);
          setAddCustomerName('');
          setAddCustomerPhone('');
          setAddCustomerPhoneError('');
        }}
        title="Add new customer"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = addCustomerName.trim();
            if (!name) {
              toast.error('Name is required');
              return;
            }
            if (!addCustomerPhone.trim()) {
              setAddCustomerPhoneError('Phone is required (03XXXXXXXXX)');
              return;
            }
            try {
              validatePakistaniPhone(addCustomerPhone.trim());
            } catch {
              setAddCustomerPhoneError('Use format 03XXXXXXXXX (e.g. 03001234567)');
              return;
            }
            addCustomerMutation.mutate({
              name,
              phone: validatePakistaniPhone(addCustomerPhone.trim()),
            });
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={addCustomerName}
              onChange={(e) => setAddCustomerName(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Full name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone * (Pakistani: 03XXXXXXXXX)</label>
            <input
              type="tel"
              value={addCustomerPhone}
              onChange={(e) => { setAddCustomerPhone(e.target.value); setAddCustomerPhoneError(''); }}
              required
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${addCustomerPhoneError ? 'border-red-500' : 'border-gray-300'}`}
              placeholder={PAKISTANI_PHONE_PLACEHOLDER}
            />
            {addCustomerPhoneError && <p className="mt-1 text-sm text-red-600">{addCustomerPhoneError}</p>}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowAddCustomerModal(false);
                setAddCustomerName('');
                setAddCustomerPhone('');
                setAddCustomerPhoneError('');
              }}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={addCustomerMutation.isPending}>
              Add customer
            </Button>
          </div>
        </form>
      </Modal>

      {/* Link existing customer confirmation (phone belongs to a sibling brand) */}
      <Modal
        isOpen={linkConfirm != null}
        onClose={() => setLinkConfirm(null)}
        title="Customer already exists"
      >
        {linkConfirm && (
          <div className="space-y-4">
            <p className="text-gray-700">
              <span className="font-mono">{linkConfirm.phone}</span> already belongs to{' '}
              <strong>{linkConfirm.existingName ?? 'an existing customer'}</strong> under another brand.
              Link this customer to your brand so you can use them here?
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setLinkConfirm(null)}>Cancel</Button>
              <Button
                isLoading={addCustomerMutation.isPending}
                onClick={() =>
                  addCustomerMutation.mutate({ name: linkConfirm.name, phone: linkConfirm.phone, link: true })
                }
              >
                Link customer
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ItemConfigModal
        isOpen={showItemModal}
        onClose={() => {
          setShowItemModal(false);
          setSelectedItemForConfig(null);
          setEditingCartIndex(null);
          setItemConfig({ addons: [], modifiers: [] });
        }}
        item={selectedItemForConfig}
        config={itemConfig}
        onConfigChange={setItemConfig}
        onConfirm={confirmAddItem}
        onToggleAddon={toggleAddon}
        onToggleModifier={toggleModifier}
        onUpdateAddonQuantity={updateAddonQuantity}
        onUpdateModifierQuantity={updateModifierQuantity}
      />

      <DealConfigModal
        isOpen={showDealModal}
        onClose={() => {
          setShowDealModal(false);
          setSelectedDeal(null);
          setEditingDealIndex(null);
          setDealInitialComponents(null);
        }}
        deal={selectedDeal}
        initialComponents={dealInitialComponents}
        onConfirm={handleDealConfirm}
      />
    </>
  );
};

export default OrderTaking;
