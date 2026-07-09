import React, { useState, useRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  OnScreenKeyboardProvider,
  useOnScreenKeyboard,
  isEligible,
  pickLayout,
  replaceSelection,
  backspace,
} from './OnScreenKeyboardContext';

const Toggle: React.FC = () => {
  const { enabled, toggle } = useOnScreenKeyboard();
  return (
    <>
      <button onClick={toggle}>toggle-kb</button>
      <span data-testid="enabled">{String(enabled)}</span>
      <input aria-label="field" defaultValue="" />
    </>
  );
};

/** Controlled input whose value we mutate via the keyboard helpers, proving React onChange fires. */
const ControlledField: React.FC<{
  op: (el: HTMLInputElement) => void;
  initial?: string;
}> = ({ op, initial = '' }) => {
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input aria-label="field" ref={ref} value={val} onChange={(e) => setVal(e.target.value)} />
      <button onClick={() => ref.current && op(ref.current)}>apply</button>
      <span data-testid="value">{val}</span>
    </>
  );
};

beforeEach(() => localStorage.clear());

describe('OnScreenKeyboard preference + wiring', () => {
  it('is disabled by default and renders no keyboard even on focus', () => {
    render(
      <OnScreenKeyboardProvider>
        <Toggle />
      </OnScreenKeyboardProvider>,
    );
    expect(screen.getByTestId('enabled').textContent).toBe('false');
    fireEvent.focus(screen.getByLabelText('field'));
    expect(document.querySelector('.simple-keyboard')).toBeNull();
  });

  it('toggle persists the preference to localStorage', () => {
    render(
      <OnScreenKeyboardProvider>
        <Toggle />
      </OnScreenKeyboardProvider>,
    );
    fireEvent.click(screen.getByText('toggle-kb'));
    expect(screen.getByTestId('enabled').textContent).toBe('true');
    expect(localStorage.getItem('foodies-onscreen-keyboard')).toBe('true');
  });

  it('docks the keyboard when an eligible field is focused', () => {
    render(
      <OnScreenKeyboardProvider>
        <Toggle />
      </OnScreenKeyboardProvider>,
    );
    fireEvent.click(screen.getByText('toggle-kb'));
    act(() => (screen.getByLabelText('field') as HTMLInputElement).focus());
    expect(document.querySelector('.simple-keyboard')).not.toBeNull();
  });
});

describe('write-back into controlled React inputs (native-setter path)', () => {
  it('replaceSelection inserts text and fires React onChange', () => {
    render(<ControlledField op={(el) => replaceSelection(el, 'ab')} />);
    act(() => fireEvent.click(screen.getByText('apply')));
    expect(screen.getByTestId('value').textContent).toBe('ab');
  });

  it('replaceSelection appends onto existing value', () => {
    render(<ControlledField initial="12" op={(el) => replaceSelection(el, '3')} />);
    act(() => fireEvent.click(screen.getByText('apply')));
    expect(screen.getByTestId('value').textContent).toBe('123');
  });

  it('backspace removes the last character and updates state', () => {
    render(<ControlledField initial="abc" op={(el) => backspace(el)} />);
    act(() => fireEvent.click(screen.getByText('apply')));
    expect(screen.getByTestId('value').textContent).toBe('ab');
  });

  it('backspace on empty value is a no-op', () => {
    render(<ControlledField initial="" op={(el) => backspace(el)} />);
    act(() => fireEvent.click(screen.getByText('apply')));
    expect(screen.getByTestId('value').textContent).toBe('');
  });
});

describe('layout + eligibility selection', () => {
  const input = (attrs: Record<string, string>) => {
    const el = document.createElement('input');
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  };

  it('numeric layout for number/tel/inputmode/data-keyboard', () => {
    expect(pickLayout(input({ type: 'number' }))).toBe('numeric');
    expect(pickLayout(input({ type: 'tel' }))).toBe('numeric');
    expect(pickLayout(input({ inputmode: 'numeric' }))).toBe('numeric');
    expect(pickLayout(input({ type: 'text', 'data-keyboard': 'numeric' }))).toBe('numeric');
  });

  it('default (QWERTY) layout for plain text', () => {
    expect(pickLayout(input({ type: 'text' }))).toBe('default');
    expect(pickLayout(input({ type: 'text', 'data-keyboard': 'default' }))).toBe('default');
  });

  it('isEligible excludes checkbox, readonly, disabled and data-keyboard=off', () => {
    expect(isEligible(input({ type: 'text' }))).toBe(true);
    expect(isEligible(input({ type: 'checkbox' }))).toBe(false);
    expect(isEligible(input({ type: 'text', readonly: 'true' }))).toBe(false);
    expect(isEligible(input({ type: 'text', disabled: 'true' }))).toBe(false);
    expect(isEligible(input({ type: 'text', 'data-keyboard': 'off' }))).toBe(false);
    const ta = document.createElement('textarea');
    expect(isEligible(ta)).toBe(true);
    expect(isEligible(null)).toBe(false);
  });
});
