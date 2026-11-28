import assert from "node:assert/strict";
import {categoryAmounts,paymentRow,paymentSummaryRow,SALES_CATEGORIES} from "./index.ts";

Deno.test("each work type has its own revenue bucket",()=>{
 for(let i=0;i<6;i++){
  const result=categoryAmounts({total:12,lines:[{detail:SALES_CATEGORIES[i]+" · Brand · Style",amount:12}]});
  assert.equal(result[i],12);
  assert.equal(result.filter((v:number)=>v!==0).length,1);
 }
});
Deno.test("mixed orders reconcile with shipping and discounts in cents",()=>{
 assert.deepEqual(categoryAmounts({total:125.5,lines:[{detail:"Apparel · DTF",amount:40},{detail:"Caps · Embroidery",amount:80}]}),[0,0,40,0,80,0,0,5.5]);
 assert.deepEqual(categoryAmounts({total:8,lines:[{detail:"Laser engraving",amount:10}]}),[0,0,0,0,0,0,10,-2]);
 assert.deepEqual(categoryAmounts({total:.3,lines:[{detail:"Apparel · Screen Print",amount:.1},{detail:"Apparel · Screen Print",amount:.2}]}),[0,.3,0,0,0,0,0,0]);
 assert.throws(()=>categoryAmounts({total:0,lines:[{amount:"invalid"}]}));
});
Deno.test("payment export preserves the original columns and appends category amounts",()=>{
 const row=paymentRow({order_id:"order",payment_method:"Cash",snapshot:{invoice:{total:12,lines:[{detail:"Caps · UV DTF",amount:12}]}}});
 assert.equal(row.length,28);assert.equal(row[0],"order");assert.equal(row[10],"Cash");assert.equal(row[15],12);assert.equal(row[25],12);
 assert.equal(row.slice(20).reduce((a:number,b:number)=>a+b,0),12);
});

Deno.test("compact Orders list omits internal and detailed fields",()=>{
 const row=paymentSummaryRow({order_id:"internal-id",payment_method:"Check",snapshot:{customer:"Customer",paymentDate:"2026-11-27",invoice:{number:"AD26-TEST",total:12,lines:[{detail:"Caps · Leather",amount:12}]}}});
 assert.equal(row.length,11);
 assert.equal(row[0],"AD26-TEST");
 assert.equal(row[3],"Customer");
 assert.equal(row[8],"Check");
 assert.equal(row[9],12);
 assert.equal(row.includes("internal-id"),false);
});
