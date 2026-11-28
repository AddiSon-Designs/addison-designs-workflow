-- Apply to existing installations that used a BEFORE payment guard.
-- The AFTER guard still rolls back invalid payments but sees actual UPDATE rows on upsert.
drop trigger require_invoice_payment_method on public.jobs;
create trigger require_invoice_payment_method after insert or update on public.jobs for each row execute function public.require_invoice_payment_method();