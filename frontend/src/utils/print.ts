/**
 * Opens a new window with the given HTML content and triggers the browser print dialog.
 * The window is closed after printing (or when the user cancels).
 *
 * `extraCss` appends template-specific styles (e.g. an invoice template's paper
 * size / thermal width) after the base stylesheet.
 */
export function printContent(html: string, title = 'Print', extraCss = ''): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    window.alert('Please allow pop-ups to print.');
    return;
  }
  printWindow.document.write(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.5; color: #111; max-width: 800px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 1.5rem; margin: 0 0 8px 0; }
    h2 { font-size: 1.1rem; margin: 20px 0 8px 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #f3f4f6; }
    th { font-weight: 600; color: #374151; }
    .text-right { text-align: right; }
    .text-sm { font-size: 0.875rem; }
    .font-medium { font-weight: 500; }
    .font-semibold { font-weight: 600; }
    .font-bold { font-weight: 700; }
    .mt-4 { margin-top: 16px; }
    .mb-2 { margin-bottom: 8px; }
    .py-2 { padding-top: 8px; padding-bottom: 8px; }
    .border-t { border-top: 1px solid #e5e7eb; }
    .total-row { font-weight: 700; font-size: 1.1rem; }
    .meta { color: #6b7280; font-size: 0.875rem; margin-bottom: 16px; }
    .section { margin-bottom: 24px; }
    @media print { body { padding: 0; } }
    ${extraCss}
  </style>
</head>
<body>
  ${html}
</body>
</html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    printWindow.print();
    printWindow.onafterprint = () => printWindow.close();
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
