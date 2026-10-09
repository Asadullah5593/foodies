import React, { forwardRef, useState } from 'react';
import SearchableSelect, { type SearchableSelectOption } from './SearchableSelect';
import { useViewport } from '../hooks/useViewport';

type Props = React.SelectHTMLAttributes<HTMLSelectElement> & { children?: React.ReactNode };

const textOf = (node: React.ReactNode): string =>
  React.Children.toArray(node)
    .map((n) => {
      if (typeof n === 'string' || typeof n === 'number') return String(n);
      if (React.isValidElement(n)) return textOf((n.props as { children?: React.ReactNode }).children);
      return '';
    })
    .join('');

/** The <option> children of a native select, as searchable options (optgroups and fragments flattened). */
export const optionsFromChildren = (children: React.ReactNode): SearchableSelectOption[] => {
  const out: SearchableSelectOption[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as { value?: string | number | readonly string[]; children?: React.ReactNode; disabled?: boolean };
    if (child.type === React.Fragment || child.type === 'optgroup') {
      out.push(...optionsFromChildren(props.children));
      return;
    }
    if (child.type !== 'option') return;
    const label = textOf(props.children);
    out.push({ value: props.value != null ? String(props.value) : label, label, disabled: props.disabled });
  });
  return out;
};

/**
 * A drop-in for a native `<select>`: on desktop (≥ lg) it IS that native select, with every prop
 * and option passed through untouched, so nothing there changes. Below lg it renders the same
 * options through SearchableSelect — a tap opens a panel with a search box, which on a phone
 * beats the browser's wheel for anything longer than a handful of entries. The page's `onChange`
 * still receives an event whose `target.value` is the chosen option, so handlers written for the
 * native select keep working.
 */
const ResponsiveSelect = forwardRef<HTMLSelectElement, Props>(function ResponsiveSelect({ children, ...props }, ref) {
  const { isDesktop } = useViewport();
  // An uncontrolled select (defaultValue) needs the chosen value remembered here below lg.
  const [inner, setInner] = useState(props.defaultValue != null ? String(props.defaultValue) : '');
  if (isDesktop) {
    return (
      <select ref={ref} {...props}>
        {children}
      </select>
    );
  }
  const { value, onChange, className, disabled, id, name, 'aria-label': ariaLabel } = props;
  const current = value != null ? String(value) : inner;
  const handle = (v: string) => {
    setInner(v);
    if (!onChange) return;
    const target = { value: v, name: name ?? '', type: 'select-one' } as unknown as HTMLSelectElement;
    onChange({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>);
  };
  return (
    <SearchableSelect
      id={id}
      value={current}
      onChange={handle}
      options={optionsFromChildren(children)}
      disabled={disabled}
      ariaLabel={ariaLabel}
      placeholder="Select…"
      triggerClassName={`${className ?? ''} inline-flex items-center justify-between gap-2 text-left`}
      minWidth=""
    />
  );
});

export default ResponsiveSelect;
