import { strict as assert } from 'node:assert';
import { Buffer } from 'node:buffer';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { archiveInvoice } from '../google-drive.ts';
import { createInvoicePdf, invoiceLocation, type Invoice } from '../invoice-pdf.ts';
import { handleCustomerEmailRequest } from '../handler.ts';

const invoice: Invoice = {
  number:'2026-0100',createdAt:'2026-11-01',orderNumber:'ORDER-1',customer:'Example Customer',
  contact:'Test Contact',email:'customer@example.invalid',
  lines:[{description:'Printed shirts',detail:'Front print',sizes:'M: 2',quantity:2,unitPrice:12.5,amount:25}],
  subtotal:25,shipping:5,rushFee:2,discount:1,total:31,
};
const configuration: Record<string,string> = {
  SUPABASE_URL:'https://shop.example.invalid',SUPABASE_ANON_KEY:'fixture-anon',
  RESEND_API_KEY:'fixture-resend',EMAIL_FROM:'shop@example.invalid',
  GOOGLE_DRIVE_INVOICE_ENABLED:'true',GOOGLE_DRIVE_CLIENT_ID:'fixture-client',
  GOOGLE_DRIVE_CLIENT_SECRET:'fixture-secret',GOOGLE_DRIVE_REFRESH_TOKEN:'fixture-refresh',
  GOOGLE_DRIVE_INVOICES_FOLDER_ID:'root-folder',GOOGLE_DRIVE_ORGANIZATION_ID:'shop-1',
};
type State = {
  role:string; organization:string; tokenStatus:number; driveStatus:number; emailStatus:number;
  existing:boolean; calls:{url:string;init:RequestInit}[]; uploads:string[]; creates:Record<string,unknown>[];
  uploadBytes:Uint8Array[];
};
async function fixtures(run:(s:State)=>Promise<void>) {
  const previous=new Map(Object.keys(configuration).map(key=>[key,Deno.env.get(key)]));
  for (const [key,value] of Object.entries(configuration)) Deno.env.set(key,value);
  const originalFetch=globalThis.fetch;
  const state:State={role:'admin',organization:'shop-1',tokenStatus:200,driveStatus:200,emailStatus:200,existing:false,calls:[],uploads:[],creates:[],uploadBytes:[]};
  globalThis.fetch=(async (input:RequestInfo|URL, init:RequestInit={})=>{
    const url=String(input);state.calls.push({url,init});
    if(url.startsWith('https://raw.githubusercontent.com/'))return new Response(null,{status:404});
    if(url.endsWith('/auth/v1/user'))return Response.json({id:'user-1'});
    if(url.includes('/rest/v1/profiles'))return Response.json([{organization_id:state.organization,role:state.role}]);
    if(url==='https://api.resend.com/emails')return Response.json({id:'email-1'},{status:state.emailStatus});
    if(url==='https://oauth2.googleapis.com/token'){
      const form=init.body as URLSearchParams;
      assert.equal(form.get('grant_type'),'refresh_token');
      assert.equal(form.get('refresh_token'),'fixture-refresh');
      return Response.json({access_token:'fixture-access',error_description:'private provider detail'},{status:state.tokenStatus});
    }
    if(url.startsWith('https://www.googleapis.com/')){
      assert.equal((init.headers as Record<string,string>).Authorization,'Bearer fixture-access');
      if(state.driveStatus!==200)return Response.json({error:'private provider detail'},{status:state.driveStatus});
      if(url.includes('/upload/')){
        const body=await (init.body as Blob).text();state.uploads.push(body);
        state.uploadBytes.push(new Uint8Array(await (init.body as Blob).arrayBuffer()));
        assert(body.includes('Content-Type: application/pdf'));
        assert(body.includes('%PDF-'));
        return Response.json({id:'pdf-1'});
      }
      if(init.method==='POST'){
        const body=JSON.parse(String(init.body));state.creates.push(body);
        return Response.json({id:body.name==='2026'?'year-folder':'month-folder'});
      }
      const q=new URL(url).searchParams.get('q')||'';
      assert(q.includes('trashed = false'));
      const id=state.existing?(q.includes('appProperties')?'pdf-1':q.includes("name = '2026'")?'year-folder':'month-folder'):null;
      return Response.json({files:id?[{id}]:[]});
    }
    throw new Error('Unexpected request: '+url);
  }) as typeof fetch;
  try {await run(state)} finally {
    globalThis.fetch=originalFetch;
    for(const [key,value] of previous)value===undefined?Deno.env.delete(key):Deno.env.set(key,value);
  }
}
function request(kind='invoice',withAuth=true) {
  return new Request('https://function.example.invalid',{method:'POST',
    headers:withAuth?{Authorization:'Bearer fixture-user'}:{},
    body:JSON.stringify({kind,meta:{email:invoice.email,customer:invoice.customer},invoice}),
  });
}

Deno.test('PDF is readable, contains multiple pages for long invoices, and preserves invoice metadata',async()=>{
  const bytes=await createInvoicePdf(invoice);
  const pdf=await PDFDocument.load(bytes);
  assert.equal(pdf.getTitle(),'Invoice 2026-0100');assert.equal(pdf.getPageCount(),1);
  const long=await createInvoicePdf({...invoice,lines:Array.from({length:70},()=>invoice.lines[0])});
  assert((await PDFDocument.load(long)).getPageCount()>1);
});
Deno.test('filename and folders follow the invoice date and sanitize path separators',()=>{
  assert.deepEqual(invoiceLocation(invoice),{year:'2026',month:'11',name:'Example Customer_2026-0100.pdf'});
  assert.equal(invoiceLocation({...invoice,customer:'A/B\\C'}).name,'A-B-C_2026-0100.pdf');
  assert.throws(()=>invoiceLocation({...invoice,createdAt:'2026-02-30'}));
  assert.throws(()=>invoiceLocation({...invoice,createdAt:'not-a-date'}));
});
Deno.test('first archive creates year and month under configured root and uploads a real PDF',()=>fixtures(async s=>{
  const result=await archiveInvoice(invoice,'shop-1');assert(result.saved);
  assert.equal(result.name,'Example Customer_2026-0100.pdf');
  assert.deepEqual(s.creates.map(x=>[x.name,x.parents]),[['2026',['root-folder']],['11',['year-folder']]]);
  assert.equal(s.uploads.length,1);
  assert(s.uploads[0].includes('"parents":["month-folder"]'));
}));
Deno.test('archive retry reuses folders and replaces the existing invoice PDF',()=>fixtures(async s=>{
  s.existing=true;assert((await archiveInvoice(invoice,'shop-1')).saved);
  assert.equal(s.creates.length,0);
  const upload=s.calls.find(x=>x.url.includes('/upload/'))!;
  assert.equal(upload.init.method,'PATCH');assert(upload.url.includes('/pdf-1?'));
  assert(!s.uploads[0].includes('"parents"'));
}));
Deno.test('disabled or incomplete configuration and wrong shop never contact Google',()=>fixtures(async s=>{
  Deno.env.set('GOOGLE_DRIVE_INVOICE_ENABLED','false');
  assert.equal((await archiveInvoice(invoice,'shop-1')).saved,false);
  Deno.env.set('GOOGLE_DRIVE_INVOICE_ENABLED','true');
  assert.equal((await archiveInvoice(invoice,'different-shop')).saved,false);
  Deno.env.delete('GOOGLE_DRIVE_REFRESH_TOKEN');
  assert.equal((await archiveInvoice(invoice,'shop-1')).saved,false);
  assert.equal(s.calls.length,0);
}));
Deno.test('revoked authorization returns an actionable error without provider details',()=>fixtures(async s=>{
  s.tokenStatus=400;const result=await archiveInvoice(invoice,'shop-1');assert(!result.saved);
  assert(result.error.includes('Reconnect'));assert(!result.error.includes('private provider detail'));
}));
Deno.test('a Drive access error does not undo a successful email',()=>fixtures(async s=>{
  s.driveStatus=403;const response=await handleCustomerEmailRequest(request());
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.sent,true);assert.equal(result.drive.saved,false);
  assert(!result.drive.error.includes('private provider detail'));
  assert.equal(s.calls.filter(x=>x.url==='https://api.resend.com/emails').length,1);
}));
Deno.test('Send preserves the live PDF attachment, email copy, and message before archiving',()=>fixtures(async s=>{
  const response=await handleCustomerEmailRequest(request());const result=await response.json();
  assert.equal(response.status,200);assert.equal(result.sent,true);assert.equal(result.drive.saved,true);
  const emailIndex=s.calls.findIndex(x=>x.url==='https://api.resend.com/emails');
  assert(emailIndex<s.calls.findIndex(x=>x.url==='https://oauth2.googleapis.com/token'));
  const email=JSON.parse(String(s.calls[emailIndex].init.body));
  assert.equal(email.subject,'Invoice 2026-0100 from AddiSon Designs');
  assert(email.html.includes('Your invoice is attached.'));assert.deepEqual(email.bcc,['sales@addisondesigns.us']);
  assert.equal(email.attachments[0].filename,'Invoice-2026-0100.pdf');
  const attached=Uint8Array.from(atob(email.attachments[0].content),(c:string)=>c.charCodeAt(0));
  assert.equal((await PDFDocument.load(attached)).getPageCount(),1);
}));
Deno.test('email failure does not archive and returns the existing failure status',()=>fixtures(async s=>{
  s.emailStatus=500;const response=await handleCustomerEmailRequest(request());
  assert.equal(response.status,502);assert(!s.calls.some(x=>x.url.includes('googleapis')));
}));
Deno.test('archive-only retry does not need an email address or email credentials and never resends',()=>fixtures(async s=>{
  Deno.env.delete('RESEND_API_KEY');Deno.env.delete('EMAIL_FROM');
  const response=await handleCustomerEmailRequest(new Request('https://function.example.invalid',{method:'POST',headers:{Authorization:'Bearer fixture-user'},body:JSON.stringify({kind:'invoice_archive',invoice})}));
  assert.equal(response.status,200);assert.equal((await response.json()).drive.saved,true);
  assert(!s.calls.some(x=>x.url.includes('resend.com')));
}));
Deno.test('worker archive and unauthenticated requests are rejected before any provider call',()=>fixtures(async s=>{
  s.role='worker';assert.equal((await handleCustomerEmailRequest(request('invoice_archive'))).status,403);
  assert.equal((await handleCustomerEmailRequest(request('invoice',false))).status,401);
  assert(!s.calls.some(x=>x.url.includes('googleapis')||x.url.includes('resend.com')));
}));
Deno.test('job status emails keep their original behavior and never archive',()=>fixtures(async s=>{
  const response=await handleCustomerEmailRequest(new Request('https://function.example.invalid',{method:'POST',headers:{Authorization:'Bearer fixture-user'},body:JSON.stringify({kind:'job_status_update',meta:{email:'customer@example.invalid',emailJobStatusUpdates:true},status:{stage:'Ready'}})}));
  const result=await response.json();assert.equal(result.sent,true);assert.equal(result.drive,undefined);
  assert(!s.calls.some(x=>x.url.includes('googleapis')));
}));

Deno.test('the displayed invoice PDF is attached and archived byte for byte',()=>fixtures(async s=>{
  const document=await PDFDocument.create();document.addPage();document.setTitle('Displayed invoice');
  const bytes=await document.save();const base64=Buffer.from(bytes).toString('base64');
  const response=await handleCustomerEmailRequest(new Request('https://function.example.invalid',{method:'POST',headers:{Authorization:'Bearer fixture-user'},body:JSON.stringify({kind:'invoice',meta:{email:invoice.email},invoice,invoicePdf:base64})}));
  const result=await response.json();assert.equal(result.sent,true);assert.equal(result.drive.saved,true);
  const email=JSON.parse(String(s.calls.find(x=>x.url==='https://api.resend.com/emails')!.init.body));
  assert.equal(email.attachments[0].content,base64);
  assert(Buffer.from(s.uploadBytes[0]).includes(Buffer.from(bytes)));
}));
Deno.test('invalid displayed PDF is rejected before sending or archiving',()=>fixtures(async s=>{
  const response=await handleCustomerEmailRequest(new Request('https://function.example.invalid',{method:'POST',headers:{Authorization:'Bearer fixture-user'},body:JSON.stringify({kind:'invoice',meta:{email:invoice.email},invoice,invoicePdf:btoa('not a PDF')})}));
  assert.equal(response.status,400);
  assert(!s.calls.some(x=>x.url.includes('resend.com')||x.url.includes('googleapis.com')));
}));
