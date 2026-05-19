import{b as a}from"./chunk-UCQ6LACX.js";import i from"mammoth";async function c(o){let e=await i.convertToMarkdown({path:o}),s=e.value,n=e.messages.filter(t=>t.type==="warning").map(t=>t.message),r=s;return n.length>0&&(r+=`

> \u26A0\uFE0F \u8F6C\u6362\u8B66\u544A:
${n.map(t=>`> - ${t}`).join(`
`)}`),{content:r}}var m=a(()=>{});m();export{c as parseDocx};
