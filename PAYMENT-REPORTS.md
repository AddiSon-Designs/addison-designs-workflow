# Paid invoice sales reports

The invoice footer requires Check, Cash, Direct deposit, Venmo, PayPal, Cash App, or Square before PAID can be selected. The database enforces the requirement as well. Prior paid invoices without a recorded method remain "Not recorded" until an administrator fills in the method.

Payment records are saved from the server's existing invoice, not from a client-supplied amount. An order has one payment record. Its original payment date determines the report year. Repeated payment saves keep the same payment date.

## Google setup

Use the existing invoice archive Google authorization. Its full Drive scope also permits Google Sheets updates, but the Google Sheets API must be enabled for project 790665496356 (addison-designs-invoice-auto):

https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=790665496356

No new paid service is needed.

Reports live under Orders / YEAR / AddiSon Designs Orders YEAR. The 2026 and 2027 workbooks have been created and registered in annual_payment_reports. Future years copy the 2027 workbook, clear the order rows, and update Dashboard B4. Report cells reserve 10,000 paid invoices per year.

## Server

Deploy supabase/functions/payment-report/index.ts with verify_jwt=false. The handler validates the bearer token with /auth/v1/user and requires the administrator's shop profile. Google credentials never enter browser code. It reuses GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN and GOOGLE_DRIVE_ORGANIZATION_ID.

Apply order-payment-reports.sql to set up the RLS-protected payment records, workbook registry, required-method trigger, and record_order_payment RPC.

Each spreadsheet export first locates the order ID in Orders column A. A retry updates that row even if the user sorted the sheet. New payments append a row. Per-order export leases prevent simultaneous retries from adding duplicate rows. Failed exports remain pending, and the app retries pending reports on sign-in. The invoice also offers Retry sales report / Sync sales report.

The Orders sheet contains customer contact and invoice information, payment method, paid amount, invoice line details, and the archived PDF link when available. Dashboard formulas and two native charts summarize paid sales by payment month and payment method.

Payment persistence is independent from Google availability. If Google fails, the invoice remains Paid in the shared app and the export is retried. Exports never send an email or invoice message.

## Sales categories

Orders U:AB contain Apparel / Embroidery, Apparel / Screen Print, Apparel / DTF, Caps / Leather, Caps / Embroidery, Caps / UV DTF, Other work, and Shipping / fees / discounts. Each invoice line is matched by its work type in detail; brand, model and color do not affect classification. Unknown work types stay in Other work. Category amounts are summed in integer cents. The adjustment column is the invoice total minus line amounts, so mixed orders reconcile without double counting or inventing a split of shipping and discounts. Historical invoices use the line prices actually saved, including zero-price lines.

Category Sales provides annual totals, shares, monthly totals and a native comparison chart. Its year links to Dashboard B4. Future-year exports clear all 28 Orders columns before using the copied template. Sorting Orders must include A:AB; the filter covers this whole range.
