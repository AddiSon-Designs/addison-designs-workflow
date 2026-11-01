import { createInvoicePdf, invoiceLocation, type Invoice } from './invoice-pdf.ts';

export type DriveArchive = { saved: true; fileId: string; name: string } |
  { saved: false; error: string };

const filesUrl = 'https://www.googleapis.com/drive/v3/files';
const quote = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// Keep Google credentials on the server. An upload failure must never undo a sent email.
export async function archiveInvoice(invoice: Invoice, organizationId: string, existingPdf?: Uint8Array): Promise<DriveArchive> {
  try {
    const get = (name: string) => Deno.env.get(name)?.trim();
    if (get('GOOGLE_DRIVE_INVOICE_ENABLED') !== 'true') {
      return { saved:false, error:'Google Drive invoice saving is not enabled yet.' };
    }
    const clientId=get('GOOGLE_DRIVE_CLIENT_ID'), clientSecret=get('GOOGLE_DRIVE_CLIENT_SECRET');
    const refreshToken=get('GOOGLE_DRIVE_REFRESH_TOKEN'), rootId=get('GOOGLE_DRIVE_INVOICES_FOLDER_ID');
    const allowedOrganization=get('GOOGLE_DRIVE_ORGANIZATION_ID');
    if (!clientId || !clientSecret || !refreshToken || !rootId || !allowedOrganization) {
      return { saved:false, error:'Google Drive invoice saving needs server configuration.' };
    }
    if (allowedOrganization !== organizationId) {
      return { saved:false, error:'Google Drive invoice saving is not configured for this shop.' };
    }
    const location=invoiceLocation(invoice), pdf=existingPdf||await createInvoicePdf(invoice);
    const tokenResponse=await fetch('https://oauth2.googleapis.com/token', {
      method:'POST', signal:AbortSignal.timeout(12000),
      body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'}),
    });
    if (!tokenResponse.ok) throw new Error('Google authorization failed. Reconnect the invoice archive account.');
    const token=await tokenResponse.json();
    if (typeof token.access_token !== 'string' || !token.access_token) throw new Error('Google did not return an access token.');
    async function drive(url: string, init: RequestInit = {}) {
      const response=await fetch(url, {...init,signal:AbortSignal.timeout(12000),headers:{...init.headers,Authorization:'Bearer '+token.access_token}});
      if (!response.ok) throw new Error('Google Drive could not save the invoice PDF. Check folder access and retry.');
      return response.json();
    }
    async function find(query: string): Promise<string | null> {
      const params=new URLSearchParams({q:query+' and trashed = false',fields:'files(id)',pageSize:'1',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
      const result=await drive(filesUrl+'?'+params);
      return result.files?.[0]?.id || null;
    }
    async function folder(parent: string, name: string): Promise<string> {
      const existing=await find(`'${quote(parent)}' in parents and name = '${quote(name)}' and mimeType = 'application/vnd.google-apps.folder'`);
      if (existing) return existing;
      const created=await drive(filesUrl+'?fields=id&supportsAllDrives=true', {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name,parents:[parent],mimeType:'application/vnd.google-apps.folder'}),
      });
      if (!created.id) throw new Error('Google Drive did not create the invoice folder.');
      return created.id;
    }
    const yearId=await folder(rootId,location.year), monthId=await folder(yearId,location.month);
    // Repeat sends and archive-only retries replace this invoice's file rather than adding another PDF.
    const existing=await find(`'${quote(monthId)}' in parents and appProperties has { key='organizationId' and value='${quote(organizationId)}' } and appProperties has { key='invoiceNumber' and value='${quote(String(invoice.number))}' }`);
    const metadata={name:location.name,mimeType:'application/pdf',...(!existing?{parents:[monthId]}:{}),appProperties:{organizationId,invoiceNumber:String(invoice.number)}};
    const boundary='invoice-'+crypto.randomUUID();
    const body=new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,new Uint8Array(pdf),`\r\n--${boundary}--\r\n`,
    ]);
    const uploaded=await drive('https://www.googleapis.com/upload/drive/v3/files'+(existing?'/'+encodeURIComponent(existing):'')+'?uploadType=multipart&fields=id&supportsAllDrives=true',{
      method:existing?'PATCH':'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body,
    });
    if (!uploaded.id) throw new Error('Google Drive did not confirm the saved PDF.');
    return {saved:true,fileId:uploaded.id,name:location.name};
  } catch (error) {
    // Do not return raw provider bodies, tokens, or unexpected runtime errors to the browser.
    const message=error instanceof Error ? error.message : '';
    const safe=/^(Google |The invoice )/.test(message);
    return {saved:false,error:safe?message:'The invoice PDF could not be saved to Google Drive. Retry the PDF save.'};
  }
}
