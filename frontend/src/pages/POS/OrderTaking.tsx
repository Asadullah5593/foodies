import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { menuService, orderService, adminService, CreateOrderRequest } from '../../services/api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import { validatePakistaniPhone, PAKISTANI_PHONE_PLACEHOLDER, normalizePakistaniPhone } from '../../utils/phone';
import { MenuItem } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import CustomerInvoiceModal from '../../components/CustomerInvoiceModal';
import { useQueryClient } from '@tanstack/react-query';
import {
  POSLayout,
  POSFilters,
  MenuGrid,
  MENU_PAGE_SIZE,
  CustomerPanel,
  CartPanel,
  PaymentPanel,
  ItemConfigModal,
  DealConfigModal,
} from './components';
import type { OrderTypeOption, CartLine } from './components';
import { defaultVariantIdForItem } from './components/types';

const OrderTaking: React.FC = () => {
  const [selectedItems, setSelectedItems] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderTypeOption>('dine_in');
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
  const [orderNotes, setOrderNotes] = useState('');
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [posSearch, setPosSearch] = useState('');
  const debouncedPosSearch = useDebouncedValue(posSearch, 300);
  const [paymentMode, setPaymentMode] = useState<'cash' | 'card' | 'multipay'>('cash');
  const [paymentCashAmount, setPaymentCashAmount] = useState<string>('');
  const [paymentCardAmount, setPaymentCardAmount] = useState<string>('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentMenuPage, setCurrentMenuPage] = useState(1);
  const [removeConfirmIndex, setRemoveConfirmIndex] = useState<number | null>(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showDealModal, setShowDealModal] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<import('../../services/api/menuService').DealDefinition | null>(null);
  const [editingCartIndex, setEditingCartIndex] = useState<number | null>(null);
  const [editingDealIndex, setEditingDealIndex] = useState<number | null>(null);
  const [dealInitialComponents, setDealInitialComponents] = useState<import('./components/types').DealComponentLine[] | null>(null);
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
  const menuAll = branchMenu?.menu ?? [];
  const brands = branchMenu?.brands ?? [];
  const branchId = branchMenu?.branch_id ?? null;
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

  React.useEffect(() => setCurrentMenuPage(1), [debouncedPosSearch, selectedBrandId, selectedCategoryId]);

  const paginatedMenu = React.useMemo(() => {
    const start = (currentMenuPage - 1) * MENU_PAGE_SIZE;
    return menuFilteredBySearch.slice(start, start + MENU_PAGE_SIZE);
  }, [menuFilteredBySearch, currentMenuPage]);

  const openShift = branchMenu?.open_shift ?? null;

  const getBrandName = (brandId: number | null | undefined): string | null =>
    brandId != null ? (brands.find((b) => b.id === brandId)?.name ?? null) : null;

  // Only show order types the selected branch explicitly supports (use strict true; no defaults so dropdown is dynamic)
  const orderTypeOptions = React.useMemo((): { value: OrderTypeOption; label: string }[] => {
    const list: { value: OrderTypeOption; label: string }[] = [];
    if (branchMenu?.supports_dine_in === true) list.push({ value: 'dine_in', label: 'Dine In' });
    // Takeaway and pickup are the same concept; standardize on "Takeaway".
    // Backend maps legacy pickup to supports_takeaway.
    if (branchMenu?.supports_takeaway === true)
      list.push({ value: 'takeaway', label: 'Takeaway' });
    if (branchMenu?.supports_delivery === true) list.push({ value: 'delivery', label: 'Delivery' });
    return list.length ? list : [{ value: 'dine_in', label: 'Dine In' }];
  }, [branchMenu?.supports_dine_in, branchMenu?.supports_takeaway, branchMenu?.supports_delivery]);

  const defaultOrderType = orderTypeOptions[0]?.value ?? 'dine_in';
  const effectiveOrderType = orderTypeOptions.some((o) => o.value === orderType) ? orderType : defaultOrderType;
  React.useEffect(() => {
    if (effectiveOrderType !== orderType) setOrderType(effectiveOrderType);
  }, [effectiveOrderType]);

  const quotePayload = branchId != null && selectedItems.length > 0
    ? {
        branch_id: branchId,
        order_type: effectiveOrderType,
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

  const { data: quote } = useQuery({
    queryKey: ['pos-quote', quotePayload],
    queryFn: () => orderService.getQuote(quotePayload!),
    enabled: quotePayload != null,
  });

  const normalizedPhone = customerPhone.trim() ? normalizePakistaniPhone(customerPhone.trim()) : null;
  const { data: loyaltyBalance } = useQuery({
    queryKey: ['loyalty-balance', branchId, normalizedPhone],
    queryFn: async () => {
      const res = await apiClient.get<{ balance: number; displayName: string }>('/public/consumer/loyalty/balance', {
        params: { branch_id: branchId, phone: normalizedPhone },
      });
      return res.data;
    },
    enabled: branchId != null && normalizedPhone != null,
  });

  React.useEffect(() => {
    const maxAllowed = loyaltyBalance?.balance ?? 0;
    if (typeof loyaltyPointsToRedeem === 'number' && loyaltyPointsToRedeem > maxAllowed) {
      setLoyaltyPointsToRedeem(maxAllowed);
    }
  }, [loyaltyBalance?.balance]);

  const addCustomerMutation = useMutation({
    mutationFn: (data: { name: string; phone: string }) => adminService.createCustomer(data),
    onSuccess: (newCustomer: { id: number; name: string | null; phone: string }) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setCustomerName((newCustomer.name ?? '').trim());
      setCustomerPhone((newCustomer.phone ?? '').trim());
      setPhoneError('');
      setShowAddCustomerModal(false);
      setAddCustomerName('');
      setAddCustomerPhone('');
      setAddCustomerPhoneError('');
      toast.success('Customer added');
    },
    onError: (err: any) => {
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
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create order');
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
    if (branchId != null) {
      try {
        const deal = await menuService.getDeal(item.id, branchId);
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
        const deal = await menuService.getDeal(line.dealId, branchId);
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
    const groups = selectedItemForConfig.modifier_groups ?? [];
    for (const group of groups) {
      if ((group.min_select ?? 0) > 0) {
        const selectedInGroup = (itemConfig.modifiers ?? []).filter(m =>
          group.modifiers.some(mod => mod.id === m.modifierId)
        );
        if (selectedInGroup.length < group.min_select) {
          toast.error(`Please select at least ${group.min_select} for "${group.name}"`);
          return;
        }
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

    // For single-select groups (min/max 1), behave like radio buttons:
    // clicking a new option unselects any previous one in this group and selects the new one.
    if (groupForModifier && (groupForModifier.max_select ?? 0) === 1) {
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

    // Multi-select groups: enforce max_select and show a friendly error.
    if (groupForModifier && currentInGroup.length >= (groupForModifier.max_select || 99)) {
      toast.error(`Maximum ${groupForModifier.max_select} allowed for ${groupForModifier.name}`);
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

  const removeItem = (index: number) => {
    setSelectedItems(selectedItems.filter((_, i) => i !== index));
  };

  const updateQuantity = (index: number, quantity: number) => {
    const updated = [...selectedItems];
    updated[index].quantity = quantity;
    setSelectedItems(updated);
  };

  const handleCreateOrder = () => {
    if (selectedItems.length === 0) {
      toast.error('Please add items to the order');
      return;
    }
    if (!customerName.trim()) {
      toast.error('Customer name is required');
      return;
    }
    if (!customerPhone.trim()) {
      toast.error('Customer phone is required (Pakistani format: 03XXXXXXXXX)');
      return;
    }
    try {
      validatePakistaniPhone(customerPhone.trim());
    } catch {
      setPhoneError('Use format 03XXXXXXXXX (e.g. 03001234567)');
      toast.error('Invalid Pakistani phone number');
      return;
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

  const total = selectedItems.reduce((sum, item) => {
    if (item.dealPrice != null && item.components?.length) {
      const componentExtras = item.components.reduce((s, c) => {
        const addonsPrice = (c.addons ?? []).reduce((aSum, a) => {
          const addonItem = c.menuItem.addons?.find(ad => ad.id === a.addonId);
          return aSum + (addonItem?.price || 0) * a.quantity;
        }, 0);
        const modifiersPrice = (c.modifiers ?? []).reduce((mSum, m) => {
          const mod = c.menuItem.modifier_groups?.flatMap(g => g.modifiers).find(mo => mo.id === m.modifierId);
          return mSum + (mod?.price || 0) * m.quantity;
        }, 0);
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
    const modifiersPrice = (item.modifiers ?? []).reduce((modSum, mod) => {
      const modObj = item.menuItem.modifier_groups
        ?.flatMap(g => g.modifiers)
        .find(m => m.id === mod.modifierId);
      return modSum + (modObj?.price || 0) * mod.quantity;
    }, 0);
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
          if (!showCheckoutModal && selectedItems.length > 0) {
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
  }, [addItem, handleCreateOrder, menuFilteredBySearch, showCheckoutModal, selectedItems.length]);

  if (loadingBranches) {
    return <Loader fullScreen text="Loading..." />;
  }

  if (posBranches && posBranches.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <Card>
          <div className="text-center py-8 max-w-md">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-slate-100 mb-2">No branches available for POS</h2>
            <p className="text-gray-600 dark:text-slate-400">No branch has an open shift. Open a shift in Admin → Shifts. If you are not a super admin, you also need to be assigned to a branch in Admin → Branch Users.</p>
          </div>
        </Card>
      </div>
    );
  }

  if (effectiveBranchId != null && isLoading) {
    return <Loader fullScreen text="Loading menu..." />;
  }

  const isSubmitting = createOrderMutation.isPending || addCustomerMutation.isPending;
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
  };

  if (effectiveBranchId != null && branchId != null && !openShift) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] bg-foodies-surfaceMuted dark:bg-slate-900 p-6">
        <Card className="w-full max-w-md">
          <div className="mb-4">
            <POSFilters {...filtersProps} />
          </div>
          <div className="text-center py-6">
            <h2 className="text-2xl font-bold text-foodies-textPrimary dark:text-slate-100 mb-2">No shift open for this branch</h2>
            <p className="text-foodies-textSecondary dark:text-slate-400">Open a shift in Admin → Shifts before using POS. Only one shift can be open per branch at a time. You can switch branch above.</p>
          </div>
        </Card>
      </div>
    );
  }

  if (!menu || menu.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] bg-foodies-surfaceMuted dark:bg-slate-900 p-6">
        <Card className="w-full max-w-md">
          <div className="mb-4">
            <POSFilters {...filtersProps} />
          </div>
          <div className="text-center py-8">
            <h2 className="text-2xl font-bold text-foodies-textPrimary dark:text-slate-100 mb-2">No menu items for this branch</h2>
            <p className="text-foodies-textSecondary dark:text-slate-400">Add menu items and enable the menu for this branch in the admin panel. You can switch branch above.</p>
          </div>
        </Card>
      </div>
    );
  }

  const checkoutSectionContent = (
      <>
        <div className="flex-shrink-0 px-6 py-4 bg-foodies-surface dark:bg-slate-800 border-b border-foodies-border dark:border-slate-700">
          <h2 className="text-xl font-bold text-foodies-textPrimary dark:text-slate-100 tracking-tight">Cart</h2>
          <p className="text-sm text-foodies-textSecondary dark:text-slate-400 mt-0.5">Review items here, then checkout</p>
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
          <div className="flex items-center justify-between text-sm text-foodies-textSecondary dark:text-slate-400">
            <span>Total</span>
            <span className="font-bold text-foodies-textPrimary dark:text-slate-100">{formatCurrency(quote?.total_amount ?? total)}</span>
          </div>
          <Button
            variant="gradient"
            className="w-full mt-3 font-semibold py-3 rounded-xl"
            size="large"
            disabled={selectedItems.length === 0}
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

  return (
    <>
      <POSLayout
        centerSection={
          <>
            {/* Top bar (desktop + mobile): branch/order type/brand/category + search */}
            <div className="flex-shrink-0 px-4 py-3 bg-foodies-surface border-b border-foodies-border dark:bg-slate-800 dark:border-slate-700">
              <div className="lg:hidden">
                <POSFilters
                  {...filtersProps}
                  variant="bar"
                  searchInputRef={searchInputRefMobile}
                />
              </div>
              <div className="hidden lg:block">
                <POSFilters
                  {...filtersProps}
                  variant="bar"
                  searchInputRef={searchInputRefDesktop}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
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
          </div>

          <div className="rounded-xl border border-foodies-border dark:border-slate-600 bg-foodies-surface dark:bg-slate-800 p-4">
            <h3 className="text-sm font-semibold text-foodies-textPrimary dark:text-slate-100 mb-3">Customer &amp; details</h3>
            <CustomerPanel
              orderTypeOptions={orderTypeOptions}
              orderType={effectiveOrderType}
              onOrderTypeChange={setOrderType}
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
              onAddCustomerClick={() => setShowAddCustomerModal(true)}
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
              onCreateOrder={handleCreateOrder}
              isSubmitting={createOrderMutation.isPending}
              itemCount={selectedItems.length}
              lastOrderGroupId={lastOrderGroupId}
              onViewInvoice={() => setShowCustomerInvoiceModal(true)}
            />
            <div className="flex justify-end mt-3">
              <Button variant="outline" onClick={() => setShowCheckoutModal(false)}>
                Close
              </Button>
            </div>
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
