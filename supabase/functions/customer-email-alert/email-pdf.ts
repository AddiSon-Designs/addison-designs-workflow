import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

// Preserve the PDF layout and attachment encoding already used by the live invoice service.
const pdfSafe=(value:unknown)=>String(value??"").normalize("NFKD").replace(/[^\x20-\x7E]/g," ").replace(/\s+/g," ").trim();
const formatMoney=(value:unknown)=>"$"+Number(value||0).toFixed(2);
function fitText(value:unknown,font:any,size:number,maxWidth:number){let text=pdfSafe(value);while(text&&font.widthOfTextAtSize(text,size)>maxWidth){if(text.length<=3)return "";text=text.slice(0,-4).trimEnd()+"...";}return text}
export async function renderInvoicePdf(invoice:Record<string,any>,meta:Record<string,any>){
 const doc=await PDFDocument.create(),regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 doc.setTitle("Invoice "+invoice.number);doc.setAuthor("AddiSon Designs");
 const ink=rgb(0.145,0.145,0.122),muted=rgb(0.41,0.45,0.51),khaki=rgb(0.765,0.725,0.56),tableHead=rgb(0.941,0.933,0.89),line=rgb(0.89,0.91,0.93);
 const W=612,H=792,M=36,contentW=W-M*2;let page=doc.addPage([W,H]);let logo:any=null;
 try{const response=await fetch("https://raw.githubusercontent.com/AddiSon-Designs/addison-designs-workflow/main/brand-icon-192-20261013.png");if(response.ok)logo=await doc.embedPng(new Uint8Array(await response.arrayBuffer()))}catch{}
 const text=(value:unknown,x:number,y:number,size=10,font=regular,color=ink,maxWidth=500)=>page.drawText(fitText(value,font,size,maxWidth),{x,y,size,font,color});
 const rule=(y:number,thickness=0.7,color=line)=>page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness,color});
 const header=()=>{
  if(logo)page.drawImage(logo,{x:M,y:H-104,width:72,height:72});
  text("AddiSon Designs",M+84,H-52,18,bold,ink,174);
  text("1411 County Road 1716 · Holly Pond, AL 35083",M+84,H-68,8,regular,muted,158);
  text("Phone: 205-224-2464",M+84,H-81,8,regular,muted,158);
  text("Bringing your ideas to life",M+84,H-96,10,regular,muted,158);
  text("INVOICE",280,H-48,18,bold,ink,112);
  text(invoice.number,280,H-67,10,bold,ink,112);
  if(invoice.orderNumber||meta.orderNumber)text("Order: "+(invoice.orderNumber||meta.orderNumber),280,H-82,8,regular,muted,112);
  text("Date: "+(invoice.createdAt||new Date().toISOString().slice(0,10)),280,H-96,8,regular,muted,112);
  text("Bill to",W-M-168,H-48,9,bold,ink,168);
  text(invoice.customer||meta.customer||"Customer",W-M-168,H-64,10,bold,ink,168);
  if(invoice.contact||meta.contact)text(invoice.contact||meta.contact,W-M-168,H-79,8,regular,muted,168);
  if(invoice.phone||meta.phone)text(invoice.phone||meta.phone,W-M-168,H-92,8,regular,muted,168);
  if(invoice.email||meta.email)text(invoice.email||meta.email,W-M-168,H-105,8,regular,muted,168);
  if(invoice.dueDate||meta.dueDate)text("Due date: "+(invoice.dueDate||meta.dueDate),W-M-168,H-118,8,regular,muted,168);
  page.drawLine({start:{x:M,y:H-129},end:{x:W-M,y:H-129},thickness:2,color:khaki});
 };
 const startPage=(continued=false)=>{page=doc.addPage([W,H]);header();let y=H-157;if(continued){text("Invoice details (continued)",M,y,10,bold);y-=20}return y};
 header();
 let y=H-163;page.drawRectangle({x:M,y:y-8,width:contentW,height:24,color:tableHead});
 text("DESCRIPTION",M+8,y,8,bold,muted,300);text("QTY",W-M-197,y,8,bold,muted,36);text("PRICE EACH",W-M-150,y,8,bold,muted,72);text("AMOUNT",W-M-75,y,8,bold,muted,67);y-=32;
 const rows=Array.isArray(invoice.lines)?invoice.lines:[];
 for(const row of rows){const rowHeight=row.sizes?48:36;if(y<128+rowHeight)y=startPage(true);text(row.description,M+8,y,9,bold,ink,280);if(row.detail)text(row.detail,M+8,y-13,8,regular,muted,280);if(row.sizes)text("Sizes: "+row.sizes,M+8,y-26,8,regular,muted,280);text(row.quantity,W-M-197,y,8,regular,ink,36);text(row.unitPrice===null?"—":formatMoney(row.unitPrice),W-M-150,y,8,regular,ink,72);text(formatMoney(row.amount),W-M-75,y,8,bold,ink,67);y-=rowHeight;rule(y+8)}
 if(y<190)y=startPage(true);y-=8;const totalX=W-M-190;const summary=(label:string,value:string,strong=false)=>{text(label,totalX,y,strong?10:9,strong?bold:regular,strong?ink:muted,105);text(value,W-M-75,y,strong?11:9,strong?bold:regular,ink,75);y-=18};summary("Subtotal",formatMoney(invoice.subtotal));summary("Shipping",formatMoney(invoice.shipping));summary("Rush fee",formatMoney(invoice.rushFee));summary("Discount","-"+formatMoney(invoice.discount));rule(y+8,1.4,khaki);summary("TOTAL DUE",formatMoney(invoice.total),true);
 text("Thank you for your business.",M,48,9,regular,muted);text("Bringing your ideas to life",M,34,8,regular,muted);return await doc.save();
}
export function toBase64(bytes:Uint8Array){let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary)}
