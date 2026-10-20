import { cu } from '../customersUi';

/** `cu.input` without the full width, for filters and pickers that sit in a row. */
export const inputInline = cu.input.replace('w-full ', '');
