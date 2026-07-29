import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type OrderTypeSlotOption = { value: string; label: string };

export type OrderTypeSlot = {
  options: OrderTypeSlotOption[];
  value: string | null;
} | null;

type ContextValue = {
  slot: OrderTypeSlot;
  setSlot: (slot: OrderTypeSlot) => void;
  handlerRef: React.MutableRefObject<((value: string) => void) | null>;
  change: (value: string) => void;
};

const POSOrderTypeContext = createContext<ContextValue | null>(null);

/**
 * Lets the POS page drive the order-type tabs that are rendered up in the app
 * navbar. The navbar sits in Layout, the state lives in OrderTaking, so the two
 * meet here rather than lifting all of the POS's order-type logic (menu
 * refiltering, cart-line compatibility prompts) into the shell.
 */
export const POSOrderTypeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [slot, setSlotState] = useState<OrderTypeSlot>(null);
  // The POS's onChange is re-created every render; holding it in a ref keeps
  // the registration effect off its identity, so it can depend on the data only.
  const handlerRef = useRef<((value: string) => void) | null>(null);

  const setSlot = useCallback((next: OrderTypeSlot) => setSlotState(next), []);
  const change = useCallback((value: string) => handlerRef.current?.(value), []);

  const value = useMemo(
    () => ({ slot, setSlot, handlerRef, change }),
    [slot, setSlot, change],
  );

  return (
    <POSOrderTypeContext.Provider value={value}>
      {children}
    </POSOrderTypeContext.Provider>
  );
};

/** Navbar side: what to render, and how to report a tap. Null outside the provider. */
export function usePOSOrderTypeSlot(): {
  slot: OrderTypeSlot;
  change: (value: string) => void;
} {
  const ctx = useContext(POSOrderTypeContext);
  return { slot: ctx?.slot ?? null, change: ctx?.change ?? (() => undefined) };
}

/**
 * POS side: publish the tabs while this screen is mounted, and take them down
 * on the way out so the navbar never shows a stale control on another page.
 */
export function useRegisterPOSOrderType(
  options: OrderTypeSlotOption[],
  value: string | null,
  onChange: (value: string) => void,
): void {
  const ctx = useContext(POSOrderTypeContext);
  const setSlot = ctx?.setSlot;
  const handlerRef = ctx?.handlerRef;

  // No dep array: keeps the handler current without touching slot state.
  useEffect(() => {
    if (handlerRef) handlerRef.current = onChange;
  });

  useEffect(() => {
    setSlot?.({ options, value });
  }, [setSlot, options, value]);

  useEffect(
    () => () => {
      setSlot?.(null);
      if (handlerRef) handlerRef.current = null;
    },
    [setSlot, handlerRef],
  );
}

export default POSOrderTypeContext;
