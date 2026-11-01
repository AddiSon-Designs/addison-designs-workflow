import { renderInvoicePdf } from './email-pdf.ts';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

export async function decodeDisplayedInvoicePdf(value: unknown): Promise<Uint8Array> {
  if (typeof value !== 'string' || value.length > 21 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('The invoice PDF is invalid or too large.');
  let bytes: Uint8Array;
  try { bytes=Uint8Array.from(atob(value), character=>character.charCodeAt(0)); }
  catch { throw new Error('The invoice PDF is invalid.'); }
  if (bytes.length > 15*1024*1024 || new TextDecoder().decode(bytes.subarray(0,5)) !== '%PDF-') {
    throw new Error('The invoice PDF is invalid or too large.');
  }
  try {
    const pdf=await PDFDocument.load(bytes);
    if (pdf.getPageCount()<1 || pdf.getPageCount()>100) throw new Error('Invalid page count');
  } catch { throw new Error('The invoice PDF could not be read.'); }
  return bytes;
}

export type Invoice = Record<string, unknown> & {
  number: string;
  createdAt: string;
  lines: Record<string, unknown>[];
};

export function invoiceLocation(invoice: Invoice) {
  const date = String(invoice.createdAt || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date + 'T00:00:00Z')) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) {
    throw new Error('The invoice needs a valid creation date before its PDF can be saved.');
  }
  const safe = (value: unknown, fallback: string) => String(value || fallback)
    .replace(/[\x00-\x1f\x7f/\\]/g, '-').trim().slice(0, 160) || fallback;
  return {
    year: date.slice(0, 4), month: date.slice(5, 7),
    name: `${safe(invoice.customer, 'Customer')}_${safe(invoice.number, 'Invoice')}.pdf`,
  };
}

export async function createInvoicePdf(invoice: Invoice, meta: Record<string, unknown> = {}): Promise<Uint8Array> {
  if (!invoice.number || !Array.isArray(invoice.lines) || invoice.lines.length > 500 ||
      invoice.lines.some(item => !item || typeof item !== 'object')) {
    throw new Error('The invoice details cannot be rendered as a PDF.');
  }
  for (const amount of [invoice.total, invoice.subtotal, invoice.shipping, invoice.rushFee, invoice.discount,
      ...invoice.lines.flatMap(item => [item.amount, item.unitPrice])]) {
    if (!Number.isFinite(Number(amount || 0))) throw new Error('The invoice contains an invalid amount.');
  }
  return renderInvoicePdf(invoice, meta);
}
