/* Render the existing invoice paper so emailed and archived PDFs keep its layout. */
(function () {
 'use strict';
 window.createDisplayedInvoicePdf = async function (number) {
  const paper = document.querySelector('#invoiceBackdrop .invoice-paper');
  if (!paper || typeof window.html2pdf !== 'function') throw new Error('Reopen the invoice to prepare its PDF.');
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  await Promise.all(Array.from(paper.querySelectorAll('img')).map(async image => {
   if (typeof image.decode === 'function') await image.decode();
   if (!image.naturalWidth) throw new Error('The invoice logo could not be loaded.');
  }));
  const clone = paper.cloneNode(true);
  // Match the existing Print / Save PDF view. Totals already show these values.
  clone.style.padding = '0';
  clone.style.margin = '0';
  clone.style.width = '100%';
  clone.style.fontFamily = getComputedStyle(paper).fontFamily;
  const businessName=clone.querySelector('.invoice-brand h1');
  if (businessName) businessName.style.whiteSpace='nowrap';
  clone.querySelectorAll('.invoice-adjustments,.invoice-date-toggle,.invoice-date-editor').forEach(element => element.remove());
  clone.querySelectorAll('tr,.invoice-brand,.invoice-totals').forEach(element => {
   element.style.breakInside = 'avoid';
  });
  const pdf = await window.html2pdf().set({
   margin:28,
   image:{type:'png'},
   html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff',windowWidth:1000,scrollX:0,scrollY:0,logging:false},
   jsPDF:{unit:'pt',format:'letter',orientation:'portrait',compress:true},
   pagebreak:{mode:['css','legacy'],avoid:['tr','.invoice-brand','.invoice-totals','.invoice-status']},
  }).from(clone).toPdf().get('pdf');
  pdf.setProperties({title:'Invoice '+String(number || ''),author:'AddiSon Designs'});
  const bytes = new Uint8Array(pdf.output('arraybuffer'));
  if (bytes.length > 15 * 1024 * 1024) throw new Error('This invoice PDF is too large to email.');
  let binary = '';
  for (let offset=0; offset<bytes.length; offset+=0x8000) {
   binary += String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  }
  return btoa(binary);
 };
})();
