import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import apiClient from '../../utils/apiClient';
import { menuService, orderService, adminService, CreateOrderRequest } from '../../services/api';
import { validatePakistaniPhone, PAKISTANI_PHONE_PLACEHOLDER, normalizePakistaniPhone } from '../../utils/phone';
import { MenuItem } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import CustomerSearchSelect from '../../components/CustomerSearchSelect';
import { useQueryClient } from '@tanstack/react-query';

export type OrderTypeOption = 'dine_in' | 'takeaway' | 'pickup' | 'delivery';

const OrderTaking: React.FC = () => {
  const [selectedItems, setSelectedItems] = useState<Array<{
    menuItem: MenuItem;
    quantity: number;
    variantId?: number;
    addons: Array<{ addonId: number; quantity: number }>;
    notes?: string;
  }>>([]);
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
    notes?: string;
  }>({ addons: [] });
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [lastOrderGroupId, setLastOrderGroupId] = useState<string | null>(null);
  const [showCustomerInvoiceModal, setShowCustomerInvoiceModal] = useState(false);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [addCustomerName, setAddCustomerName] = useState('');
  const [addCustomerPhone, setAddCustomerPhone] = useState('');
  const [addCustomerPhoneError, setAddCustomerPhoneError] = useState('');
  const queryClient = useQueryClient();

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
  const menu = branchMenu?.menu ?? [];
  const branchId = branchMenu?.branch_id ?? null;
  const openShift = branchMenu?.open_shift ?? null;

  // Only show order types the selected branch explicitly supports (use strict true; no defaults so dropdown is dynamic)
  const orderTypeOptions = React.useMemo((): { value: OrderTypeOption; label: string }[] => {
    const list: { value: OrderTypeOption; label: string }[] = [];
    if (branchMenu?.supports_dine_in === true) list.push({ value: 'dine_in', label: 'Dine In' });
    if (branchMenu?.supports_takeaway === true) list.push({ value: 'takeaway', label: 'Takeaway' });
    if (branchMenu?.supports_pickup === true) list.push({ value: 'pickup', label: 'Pickup' });
    if (branchMenu?.supports_delivery === true) list.push({ value: 'delivery', label: 'Delivery' });
    return list.length ? list : [{ value: 'dine_in', label: 'Dine In' }];
  }, [branchMenu?.supports_dine_in, branchMenu?.supports_takeaway, branchMenu?.supports_pickup, branchMenu?.supports_delivery]);

  const defaultOrderType = orderTypeOptions[0]?.value ?? 'dine_in';
  const effectiveOrderType = orderTypeOptions.some((o) => o.value === orderType) ? orderType : defaultOrderType;
  React.useEffect(() => {
    if (effectiveOrderType !== orderType) setOrderType(effectiveOrderType);
  }, [effectiveOrderType]);

  const quotePayload = branchId != null && selectedItems.length > 0
    ? {
        branch_id: branchId,
        order_type: effectiveOrderType,
        items: selectedItems.map(item => ({
          menu_item_id: item.menuItem.id,
          quantity: item.quantity,
          variant_id: item.variantId,
          addons: item.addons.map(a => ({ addon_id: a.addonId, quantity: a.quantity })),
        })),
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
    mutationFn: orderService.createOrder,
    onSuccess: (data: { order_group_id: string; orders: Array<{ order_number: string; total_amount?: number }> }) => {
      const orders = data?.orders ?? [];
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
      setSelectedItems([]);
      setTableNumber('');
      setDiscountCode('');
      setCustomerName('');
      setCustomerPhone('');
      setDeliveryAddress('');
      setLoyaltyPointsToRedeem('');
      setPhoneError('');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create order');
    },
  });

  const { data: mainInvoice, isLoading: mainInvoiceLoading } = useQuery({
    queryKey: ['order-group-main-invoice', lastOrderGroupId],
    queryFn: () => orderService.getOrderGroupMainInvoice(lastOrderGroupId!),
    enabled: showCustomerInvoiceModal && !!lastOrderGroupId,
  });

  const addItem = (item: MenuItem) => {
    if (!openShift) {
      toast.error('Open a shift in Admin → Shifts before adding items to the order');
      return;
    }
    // If item has variants or addons, show modal for configuration
    if ((item.variants && item.variants.length > 0) || (item.addons && item.addons.length > 0)) {
      setSelectedItemForConfig(item);
      setItemConfig({ addons: [] });
      setShowItemModal(true);
    } else {
      // Add directly if no variants/addons
      setSelectedItems([...selectedItems, {
        menuItem: item,
        quantity: 1,
        addons: [],
      }]);
      setJustAddedItem(item.id);
      setTimeout(() => setJustAddedItem(null), 500);
      toast.success(`${item.name} added to order`);
    }
  };

  const confirmAddItem = () => {
    if (!selectedItemForConfig) return;
    
    setSelectedItems([...selectedItems, {
      menuItem: selectedItemForConfig,
      quantity: 1,
      variantId: itemConfig.variantId,
      addons: itemConfig.addons,
      notes: itemConfig.notes,
    }]);
    setJustAddedItem(selectedItemForConfig.id);
    setTimeout(() => setJustAddedItem(null), 500);
    toast.success(`${selectedItemForConfig.name} added to order`);
    setShowItemModal(false);
    setSelectedItemForConfig(null);
    setItemConfig({ addons: [] });
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
    const payload: CreateOrderRequest = {
      branch_id: branchId,
      order_type: effectiveOrderType,
      table_number: effectiveOrderType === 'dine_in' ? tableNumber : undefined,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      delivery_address: effectiveOrderType === 'delivery' ? deliveryAddress.trim() : undefined,
      discount_code: discountCode.trim() || undefined,
      loyalty_points_to_redeem: typeof loyaltyPointsToRedeem === 'number' && loyaltyPointsToRedeem > 0 ? loyaltyPointsToRedeem : undefined,
      items: selectedItems.map(item => ({
        menu_item_id: item.menuItem.id,
        quantity: item.quantity,
        variant_id: item.variantId,
        addons: item.addons.map(a => ({
          addon_id: a.addonId,
          quantity: a.quantity,
        })),
        notes: item.notes,
      })),
    };
    createOrderMutation.mutate(payload);
  };

  const total = selectedItems.reduce((sum, item) => {
    const basePrice = item.menuItem.price || item.menuItem.base_price || 0;
    const variantPrice = item.variantId && item.menuItem.variants
      ? item.menuItem.variants.find(v => v.id === item.variantId)?.price_modifier || 0
      : 0;
    const addonsPrice = item.addons.reduce((addonSum, addon) => {
      const addonItem = item.menuItem.addons?.find(a => a.id === addon.addonId);
      return addonSum + (addonItem?.price || 0) * addon.quantity;
    }, 0);
    return sum + (basePrice + variantPrice + addonsPrice) * item.quantity;
  }, 0);

  if (loadingBranches) {
    return <Loader fullScreen text="Loading..." />;
  }

  if (posBranches && posBranches.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Card>
          <div className="text-center py-8 max-w-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">No branches available for POS</h2>
            <p className="text-gray-600">No branch has an open shift. Open a shift in Admin → Shifts. If you are not a super admin, you also need to be assigned to a branch in Admin → Branch Users.</p>
          </div>
        </Card>
      </div>
    );
  }

  if (effectiveBranchId != null && isLoading) {
    return <Loader fullScreen text="Loading menu..." />;
  }

  const BranchSelector = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-gray-600">Branch</span>
      <select
        value={effectiveBranchId ?? ''}
        onChange={(e) => {
          const id = e.target.value ? +e.target.value : null;
          setSelectedBranchId(id);
          setSelectedItems([]);
        }}
        className="px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 bg-white min-w-[140px] text-gray-800"
      >
        {posBranches?.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} ({b.code})
          </option>
        ))}
      </select>
      {branchId && openShift && (
        <span className="text-green-600 font-medium">
          · Shift: {openShift.shift_number ?? openShift.id} (open)
        </span>
      )}
    </div>
  );

  if (effectiveBranchId != null && branchId != null && !openShift) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 p-6">
        <Card className="w-full max-w-md">
          <div className="mb-4">{BranchSelector}</div>
          <div className="text-center py-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">No shift open for this branch</h2>
            <p className="text-gray-600">Open a shift in Admin → Shifts before using POS. Only one shift can be open per branch at a time. You can switch branch above.</p>
          </div>
        </Card>
      </div>
    );
  }

  if (!menu || menu.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 p-6">
        <Card className="w-full max-w-md">
          <div className="mb-4">{BranchSelector}</div>
          <div className="text-center py-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">No menu items for this branch</h2>
            <p className="text-gray-600">Add menu items and enable the menu for this branch in the admin panel. You can switch branch above.</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Menu Section – compact header and grid */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        <div className="flex-shrink-0 px-4 py-2 border-b border-gray-200 flex items-center justify-between gap-2">
          {BranchSelector}
          <h2 className="text-sm font-semibold text-gray-600 hidden sm:block">Menu · click item to add</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3">
            <AnimatePresence>
              {menu.map(item => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => addItem(item)}
                  className={`p-3 border-2 rounded-lg cursor-pointer transition-all ${
                    justAddedItem === item.id
                      ? 'border-green-500 bg-green-50 shadow-md'
                      : 'border-gray-200 bg-white hover:border-green-400 hover:shadow-sm'
                  }`}
                >
                  <h3 className="font-semibold text-gray-800 text-sm sm:text-base mb-0.5 line-clamp-2">{item.name}</h3>
                  {item.description && (
                    <p className="text-xs text-gray-500 mb-1 line-clamp-1">{item.description}</p>
                  )}
                  <p className="text-base sm:text-lg font-bold text-green-600">
                    {formatCurrency(item.price || item.base_price || 0)}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {item.category && (
                      <span className="inline-block px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                        {typeof item.category === 'object' ? item.category.name : String(item.category)}
                      </span>
                    )}
                    {((item.variants && item.variants.length > 0) || (item.addons && item.addons.length > 0)) && (
                      <span className="text-xs text-blue-600">⚙️</span>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Order Section – fixed width, more room for items list */}
      <div className="w-[26rem] min-w-[26rem] max-w-[28rem] flex-shrink-0 flex flex-col border-l-2 border-gray-200 bg-gray-50 overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-white">
          <h2 className="text-lg font-bold text-gray-800">Current Order</h2>
        </div>
        <div className="flex-1 flex flex-col min-h-0 p-4 overflow-y-auto">
        
        {orderTypeOptions.length > 0 && (
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">Order Type</label>
            <select
              value={effectiveOrderType}
              onChange={(e) => setOrderType(e.target.value as OrderTypeOption)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              {orderTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {effectiveOrderType === 'dine_in' && (
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">Table Number</label>
            <input
              type="text"
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
              placeholder="Enter table number"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">Customer *</label>
          <CustomerSearchSelect
            value={{ name: customerName, phone: customerPhone }}
            onChange={({ name, phone }) => {
              setCustomerName(name);
              setCustomerPhone(phone);
              setPhoneError('');
            }}
            onAddClick={() => setShowAddCustomerModal(true)}
            placeholder="Search by name or phone..."
          />
          {phoneError && <p className="mt-1 text-sm text-red-600">{phoneError}</p>}
          {loyaltyBalance != null && (
            <p className="mt-1 text-sm text-green-700">
              {loyaltyBalance.displayName ?? 'Points'} balance: <strong>{loyaltyBalance.balance}</strong>
            </p>
          )}
        </div>
        {effectiveOrderType === 'delivery' && (
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">Delivery address *</label>
            <textarea
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Street, area, city"
              rows={2}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Loyalty points to redeem{loyaltyBalance != null ? ` (max ${loyaltyBalance.balance})` : ' (optional)'}
          </label>
          <input
            type="number"
            min={0}
            max={loyaltyBalance?.balance ?? undefined}
            value={loyaltyPointsToRedeem === '' ? '' : loyaltyPointsToRedeem}
            onChange={(e) => {
              const raw = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0);
              if (raw === '') {
                setLoyaltyPointsToRedeem('');
                return;
              }
              const maxAllowed = loyaltyBalance?.balance ?? Infinity;
              setLoyaltyPointsToRedeem(Math.min(raw as number, maxAllowed));
            }}
            placeholder="0"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          {quote?.loyalty_discount != null && quote.loyalty_discount > 0 && (
            <p className="mt-1 text-sm text-green-600">Discount: {formatCurrency(quote.loyalty_discount)}</p>
          )}
        </div>

        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">Discount code</label>
          <input
            type="text"
            value={discountCode}
            onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
            placeholder="Optional"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          {discountCode.trim() && quote && (quote.coupon_discount_amount ?? 0) === 0 && (
            <p className="mt-1 text-xs text-amber-700">
              Coupon not applied. Check: code is correct, this branch is allowed, and min order is met.
            </p>
          )}
        </div>

        <div className="flex-1 min-h-[120px] overflow-y-auto mb-3">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Items ({selectedItems.length})</h3>
          {selectedItems.length === 0 ? (
            <Card>
              <p className="text-center text-gray-500 py-8">No items added yet</p>
            </Card>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {selectedItems.map((item, index) => {
                  const itemPrice = item.menuItem.price || item.menuItem.base_price || 0;
                  const variantPrice = item.variantId && item.menuItem.variants
                    ? item.menuItem.variants.find(v => v.id === item.variantId)?.price_modifier || 0
                    : 0;
                  const addonsPrice = item.addons.reduce((sum, addon) => {
                    const addonItem = item.menuItem.addons?.find(a => a.id === addon.addonId);
                    return sum + (addonItem?.price || 0) * addon.quantity;
                  }, 0);
                  const itemTotal = (itemPrice + variantPrice + addonsPrice) * item.quantity;
                  const lineBreakdown = quote?.line_breakdown?.[index];
                  const originalAmount = lineBreakdown?.subtotal ?? itemTotal;
                  const lineDiscount = lineBreakdown?.discount_amount ?? 0;
                  const afterDiscount = lineBreakdown?.after_discount ?? itemTotal;

                  return (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-800">{item.menuItem.name}</h4>
                          {item.variantId && (
                            <p className="text-xs text-gray-600">
                              Variant: {item.menuItem.variants?.find(v => v.id === item.variantId)?.name}
                            </p>
                          )}
                          {item.addons.length > 0 && (
                            <p className="text-xs text-gray-600">
                              Addons: {item.addons.map(a => {
                                const addon = item.menuItem.addons?.find(ad => ad.id === a.addonId);
                                return `${addon?.name} (x${a.quantity})`;
                              }).join(', ')}
                            </p>
                          )}
                          {item.notes && (
                            <p className="text-xs text-gray-500 italic">Note: {item.notes}</p>
                          )}
                        </div>
                        <Button
                          size="small"
                          variant="danger"
                          onClick={() => removeItem(index)}
                        >
                          ×
                        </Button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-gray-600">Qty:</label>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateQuantity(index, parseInt(e.target.value) || 1)}
                            className="w-16 px-2 py-1 border border-gray-300 rounded text-center"
                          />
                        </div>
                        <div className="text-right">
                          {lineDiscount > 0 ? (
                            <>
                              <div className="text-sm text-gray-500 line-through">{formatCurrency(originalAmount)}</div>
                              <div className="text-xs text-green-600">−{formatCurrency(lineDiscount)}</div>
                              <div className="text-lg font-bold text-green-600">{formatCurrency(afterDiscount)}</div>
                            </>
                          ) : (
                            <span className="text-lg font-bold text-green-600">{formatCurrency(itemTotal)}</span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="mt-auto rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-700">
              <span>Original amount</span>
              <span>{formatCurrency(quote?.subtotal ?? total)}</span>
            </div>
            {(quote?.auto_discount_amount ?? 0) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Discount (auto)</span>
                <span>-{formatCurrency(quote!.auto_discount_amount!)}</span>
              </div>
            )}
            {(quote?.coupon_discount_amount ?? 0) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Coupon{quote?.discount_code ? ` (${quote.discount_code})` : ''}</span>
                <span>-{formatCurrency(quote!.coupon_discount_amount!)}</span>
              </div>
            )}
            {(quote?.loyalty_discount ?? 0) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Loyalty points</span>
                <span>-{formatCurrency(quote!.loyalty_discount!)}</span>
              </div>
            )}
            {((quote?.auto_discount_amount ?? 0) > 0 || (quote?.coupon_discount_amount ?? 0) > 0 || (quote?.loyalty_discount ?? 0) > 0) ? null : (
              <div className={`flex justify-between ${(quote?.discount_amount ?? 0) > 0 ? 'text-green-600' : 'text-gray-500'}`}>
                <span>Discount{quote?.discount_code ? ` (${quote.discount_code})` : ''}</span>
                <span>{(quote?.discount_amount ?? 0) > 0 ? `-${formatCurrency(quote!.discount_amount)}` : formatCurrency(0)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold pt-2 mt-2 border-t border-gray-200 text-gray-800">
              <span>Total payable</span>
              <span className="text-green-600">{formatCurrency(quote?.total_amount ?? total)}</span>
            </div>
          </div>
          <Button
            onClick={handleCreateOrder}
            disabled={createOrderMutation.isPending || selectedItems.length === 0}
            isLoading={createOrderMutation.isPending}
            className="w-full"
            size="large"
          >
            Create Order
          </Button>
          {lastOrderGroupId && (
            <Button
              variant="outline"
              className="w-full mt-2"
              onClick={() => setShowCustomerInvoiceModal(true)}
            >
              View customer invoice
            </Button>
          )}
        </div>
        </div>
      </div>

      {/* Customer invoice (unified) modal */}
      <Modal
        isOpen={showCustomerInvoiceModal}
        onClose={() => setShowCustomerInvoiceModal(false)}
        title="Customer invoice"
        size="large"
      >
        {mainInvoiceLoading ? (
          <div className="py-8 text-center text-gray-500">Loading invoice…</div>
        ) : mainInvoice ? (
          <div className="p-2 space-y-4 max-h-[70vh] overflow-y-auto">
            <p className="text-sm text-gray-600">Order group: <span className="font-mono">{mainInvoice.order_group_id}</span></p>
            {(mainInvoice.orders ?? []).map((o: { order_number: string; brand_name?: string; items?: Array<{ name_snapshot?: string; quantity: number; unit_price: number; subtotal: number }>; subtotal: number; discount_amount: number; tax_amount: number; service_charge: number; delivery_fee: number; total_amount: number }) => (
              <div key={o.order_number} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <h3 className="font-semibold text-gray-800 mb-2">
                  {o.brand_name ? `${o.brand_name} — ` : ''}Order #{o.order_number}
                </h3>
                <ul className="text-sm text-gray-700 space-y-1 mb-3">
                  {(o.items ?? []).map((line: { name_snapshot?: string; quantity: number; unit_price: number; subtotal: number }, i: number) => (
                    <li key={i} className="flex justify-between">
                      <span>{line.name_snapshot ?? 'Item'} × {line.quantity}</span>
                      <span>{formatCurrency(Number(line.subtotal))}</span>
                    </li>
                  ))}
                </ul>
                <div className="text-sm space-y-1 border-t border-gray-200 pt-2">
                  <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(Number(o.subtotal))}</span></div>
                  {Number(o.discount_amount) > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>-{formatCurrency(Number(o.discount_amount))}</span></div>}
                  <div className="flex justify-between"><span>Tax</span><span>{formatCurrency(Number(o.tax_amount))}</span></div>
                  <div className="flex justify-between"><span>Service charge</span><span>{formatCurrency(Number(o.service_charge))}</span></div>
                  {Number(o.delivery_fee) > 0 && <div className="flex justify-between"><span>Delivery</span><span>{formatCurrency(Number(o.delivery_fee))}</span></div>}
                  {((o as { loyalty_points_earned?: number }).loyalty_points_earned ?? 0) > 0 && (
                    <div className="flex justify-between text-green-700"><span>Points earned</span><span>+{((o as { loyalty_points_earned?: number }).loyalty_points_earned ?? 0)}</span></div>
                  )}
                  {((o as { loyalty_points_redeemed?: number }).loyalty_points_redeemed ?? 0) > 0 && (
                    <div className="flex justify-between text-gray-600"><span>Points redeemed</span><span>−{((o as { loyalty_points_redeemed?: number }).loyalty_points_redeemed ?? 0)}</span></div>
                  )}
                  <div className="flex justify-between font-semibold"><span>Total</span><span>{formatCurrency(Number(o.total_amount))}</span></div>
                </div>
              </div>
            ))}
            <div className="border-t-2 border-gray-300 pt-3 flex justify-between text-lg font-bold">
              <span>Gross total</span>
              <span>{formatCurrency(Number(mainInvoice.gross_total ?? 0))}</span>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setShowCustomerInvoiceModal(false)}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="py-4 text-gray-500">No invoice data. Close and try again.</div>
        )}
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

      {/* Item Configuration Modal */}
      <Modal
        isOpen={showItemModal}
        onClose={() => {
          setShowItemModal(false);
          setSelectedItemForConfig(null);
          setItemConfig({ addons: [] });
        }}
        title={selectedItemForConfig?.name || 'Configure Item'}
        size="medium"
      >
        {selectedItemForConfig && (
          <div className="space-y-4">
            {selectedItemForConfig.variants && selectedItemForConfig.variants.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Select Variant</label>
                <div className="space-y-2">
                  {selectedItemForConfig.variants.map((variant) => (
                    <label
                      key={variant.id}
                      className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                        itemConfig.variantId === variant.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="variant"
                        checked={itemConfig.variantId === variant.id}
                        onChange={() => setItemConfig({ ...itemConfig, variantId: variant.id })}
                        className="mr-3"
                      />
                      <div className="flex-1">
                        <span className="font-medium">{variant.name}</span>
                        <span className={`ml-2 ${variant.price_modifier >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {variant.price_modifier >= 0 ? '+' : ''}{formatCurrency(Math.abs(variant.price_modifier))}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {selectedItemForConfig.addons && selectedItemForConfig.addons.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Addons</label>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {selectedItemForConfig.addons.map((addon) => {
                    const isSelected = itemConfig.addons.some(a => a.addonId === addon.id);
                    const selectedAddon = itemConfig.addons.find(a => a.addonId === addon.id);

                    return (
                      <div
                        key={addon.id}
                        className={`p-3 border-2 rounded-lg ${
                          isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                        }`}
                      >
                        <label className="flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleAddon(addon.id)}
                            className="mr-3"
                          />
                          <div className="flex-1">
                            <span className="font-medium">{addon.name}</span>
                            <span className="ml-2 text-green-600">+ {formatCurrency(addon.price)}</span>
                          </div>
                        </label>
                        {isSelected && (
                          <div className="mt-2 ml-6 flex items-center gap-2">
                            <label className="text-sm">Quantity:</label>
                            <input
                              type="number"
                              min="1"
                              value={selectedAddon?.quantity || 1}
                              onChange={(e) => updateAddonQuantity(addon.id, parseInt(e.target.value) || 1)}
                              className="w-20 px-2 py-1 border border-gray-300 rounded text-center"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Special Instructions (Optional)</label>
              <textarea
                value={itemConfig.notes || ''}
                onChange={(e) => setItemConfig({ ...itemConfig, notes: e.target.value })}
                rows={3}
                placeholder="e.g., No onions, extra spicy"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => {
                setShowItemModal(false);
                setSelectedItemForConfig(null);
                setItemConfig({ addons: [] });
              }}>
                Cancel
              </Button>
              <Button onClick={confirmAddItem}>
                Add to Order
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default OrderTaking;
