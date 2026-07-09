import React from 'react';
import { renderInvoiceHtml } from './renderInvoice';
import { InvoiceVM, InvoiceLayout, InvoiceTemplateConfig } from './types';

/**
 * Renders an invoice from the shared template renderer — the SAME html/css the
 * print popup uses, so the on-screen preview matches the printout exactly.
 */
const InvoicePreview: React.FC<{
  data: InvoiceVM;
  layout: InvoiceLayout;
  config: Partial<InvoiceTemplateConfig> | null | undefined;
}> = ({ data, layout, config }) => {
  const { html, css } = renderInvoiceHtml(data, layout, config);
  return (
    <div className="flex justify-center overflow-x-auto rounded-lg bg-white p-4 text-black shadow-inner">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
};

export default InvoicePreview;
