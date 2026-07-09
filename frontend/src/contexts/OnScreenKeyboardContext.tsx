import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Keyboard from 'react-simple-keyboard';
import { MdKeyboardHide } from 'react-icons/md';
import 'react-simple-keyboard/build/css/index.css';

const KEYBOARD_KEY = 'foodies-onscreen-keyboard';

type Ctx = {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  toggle: () => void;
};

const OnScreenKeyboardContext = createContext<Ctx | null>(null);

function readStoredEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(KEYBOARD_KEY) === 'true';
  } catch {
    return false;
  }
}

type FieldEl = HTMLInputElement | HTMLTextAreaElement;

/** Text-like inputs and textareas we drive; opt out with data-keyboard="off". */
export function isEligible(el: EventTarget | null): el is FieldEl {
  if (!(el instanceof HTMLElement)) return false;
  if (el.dataset.keyboard === 'off') return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.readOnly || el.disabled) return false;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  const blocked = [
    'checkbox', 'radio', 'range', 'color', 'file',
    'submit', 'button', 'reset', 'image', 'hidden', 'date', 'time',
  ];
  return !blocked.includes(type);
}

type LayoutName = 'default' | 'shift' | 'numeric';

/** Numeric fields (amounts, table #, phone) get a keypad; everything else QWERTY. */
export function pickLayout(el: FieldEl): LayoutName {
  const dk = el.dataset.keyboard;
  if (dk === 'numeric') return 'numeric';
  if (dk === 'default') return 'default';
  const type = (el.getAttribute('type') || '').toLowerCase();
  const mode = (el.getAttribute('inputmode') || '').toLowerCase();
  if (type === 'number' || type === 'tel' || mode === 'numeric' || mode === 'decimal')
    return 'numeric';
  return 'default';
}

/** Write to a controlled React input the way React itself does, so onChange fires. */
export function setNativeValue(el: FieldEl, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function replaceSelection(el: FieldEl, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  setNativeValue(el, el.value.slice(0, start) + text + el.value.slice(end));
  const caret = start + text.length;
  requestAnimationFrame(() => {
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      /* number inputs disallow setSelectionRange */
    }
  });
}

export function backspace(el: FieldEl) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  if (start === end) {
    if (start === 0) return;
    setNativeValue(el, el.value.slice(0, start - 1) + el.value.slice(end));
    const caret = start - 1;
    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* noop */
      }
    });
  } else {
    setNativeValue(el, el.value.slice(0, start) + el.value.slice(end));
    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(start, start);
      } catch {
        /* noop */
      }
    });
  }
}

const LAYOUT = {
  // Digits live on row 1, so text fields need no separate number layout.
  default: [
    '1 2 3 4 5 6 7 8 9 0 {bksp}',
    'q w e r t y u i o p',
    'a s d f g h j k l',
    '{shift} z x c v b n m . -',
    '@ {space} {enter}',
  ],
  shift: [
    '1 2 3 4 5 6 7 8 9 0 {bksp}',
    'Q W E R T Y U I O P',
    'A S D F G H J K L',
    '{shift} Z X C V B N M , _',
    '@ {space} {enter}',
  ],
  // Keypad for numeric-only fields (table #, amounts, phone) — no letters needed.
  numeric: ['1 2 3', '4 5 6', '7 8 9', '. 0 {bksp}'],
};

const DISPLAY = {
  '{bksp}': '⌫',
  '{shift}': '⇧',
  '{enter}': '⏎',
  '{space}': 'space',
};

const DockedKeyboard: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [layoutName, setLayoutName] = useState<LayoutName>('default');
  const activeRef = useRef<FieldEl | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Own the edit buffer instead of reading it back from the DOM each keypress:
  // a number input coerces an invalid intermediate (e.g. "12.") to "", so
  // reading .value back would lose it. We keep the string here and write it out.
  const bufferRef = useRef<string>('');
  const caretRef = useRef<number>(0);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (!isEligible(e.target)) return;
      const el = e.target;
      if (blurTimer.current) clearTimeout(blurTimer.current);
      activeRef.current = el;
      bufferRef.current = el.value;
      caretRef.current = el.selectionStart ?? el.value.length;
      setLayoutName(pickLayout(el));
      setVisible(true);
      // Suppress the OS soft keyboard on touch so we don't get two keyboards.
      if (el.getAttribute('inputmode') !== 'none') {
        el.dataset.prevInputmode = el.getAttribute('inputmode') ?? '';
        el.setAttribute('inputmode', 'none');
      }
      // Keep the focused field visible above the docked bar.
      setTimeout(() => {
        try {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch {
          /* noop */
        }
      }, 60);
    };

    const restoreInputmode = (el: FieldEl) => {
      if (el.dataset.prevInputmode !== undefined) {
        if (el.dataset.prevInputmode) el.setAttribute('inputmode', el.dataset.prevInputmode);
        else el.removeAttribute('inputmode');
        delete el.dataset.prevInputmode;
      }
    };

    const onFocusOut = (e: FocusEvent) => {
      const el = e.target;
      if (isEligible(el)) restoreInputmode(el);
      // Defer: focus may be moving to another field or a keyboard key.
      blurTimer.current = setTimeout(() => {
        if (!isEligible(document.activeElement)) {
          setVisible(false);
          activeRef.current = null;
        }
      }, 150);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, []);

  const dismiss = () => {
    const el = activeRef.current;
    setVisible(false);
    activeRef.current = null;
    el?.blur();
  };

  /** Write the buffer to the field via the native setter so React's onChange fires. */
  const commit = (el: FieldEl) => {
    setNativeValue(el, bufferRef.current);
    const c = caretRef.current;
    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(c, c);
      } catch {
        /* number inputs disallow setSelectionRange */
      }
    });
  };

  /** Adopt physical-keyboard edits, but never resync to a number input's "" wipe. */
  const syncFromDom = (el: FieldEl) => {
    if (el.value !== '' && el.value !== bufferRef.current) {
      bufferRef.current = el.value;
      caretRef.current = el.selectionStart ?? el.value.length;
    }
  };

  const insert = (el: FieldEl, text: string) => {
    syncFromDom(el);
    const b = bufferRef.current;
    const c = Math.min(caretRef.current, b.length);
    bufferRef.current = b.slice(0, c) + text + b.slice(c);
    caretRef.current = c + text.length;
    commit(el);
  };

  const onKeyPress = (button: string) => {
    const el = activeRef.current;
    if (!el) return;
    switch (button) {
      case '{shift}':
        setLayoutName((n) => (n === 'shift' ? 'default' : 'shift'));
        return;
      case '{bksp}': {
        syncFromDom(el);
        const b = bufferRef.current;
        const c = Math.min(caretRef.current, b.length);
        if (c > 0) {
          bufferRef.current = b.slice(0, c - 1) + b.slice(c);
          caretRef.current = c - 1;
          commit(el);
        }
        return;
      }
      case '{space}':
        insert(el, ' ');
        return;
      case '{enter}':
        if (el instanceof HTMLTextAreaElement) insert(el, '\n');
        else dismiss();
        return;
      default:
        insert(el, button);
        // One-shot shift: drop back to lowercase after a capital.
        if (layoutName === 'shift') setLayoutName('default');
    }
  };

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'tween', duration: 0.18 }}
          className="fixed inset-x-0 bottom-0 z-[100] border-t border-slate-300 bg-slate-100 shadow-2xl dark:border-slate-600 dark:bg-slate-800"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="mx-auto max-w-3xl">
            <div className="flex justify-end px-2 pt-1">
              <button
                type="button"
                onClick={dismiss}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                aria-label="Hide keyboard"
              >
                <MdKeyboardHide className="h-4 w-4" /> Hide
              </button>
            </div>
            <Keyboard
              layoutName={layoutName}
              layout={LAYOUT}
              display={DISPLAY}
              theme="hg-theme-default hg-layout-default"
              preventMouseDownDefault
              disableButtonHold
              onKeyPress={onKeyPress}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export const OnScreenKeyboardProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [enabled, setEnabledState] = useState<boolean>(() => readStoredEnabled());

  useEffect(() => {
    try {
      localStorage.setItem(KEYBOARD_KEY, String(enabled));
    } catch {
      /* noop */
    }
  }, [enabled]);

  const setEnabled = (v: boolean) => setEnabledState(v);
  const toggle = () => setEnabledState((p) => !p);

  return (
    <OnScreenKeyboardContext.Provider value={{ enabled, setEnabled, toggle }}>
      {children}
      {enabled && <DockedKeyboard />}
    </OnScreenKeyboardContext.Provider>
  );
};

export function useOnScreenKeyboard(): Ctx {
  const ctx = useContext(OnScreenKeyboardContext);
  if (!ctx)
    throw new Error('useOnScreenKeyboard must be used within OnScreenKeyboardProvider');
  return ctx;
}
