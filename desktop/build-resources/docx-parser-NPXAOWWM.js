import"./chunk-DGJUBN33.js";import a from"mammoth";async function m(o){let e=await a.convertToMarkdown({path:o}),s=e.value,n=e.messages.filter(t=>t.type==="warning").map(t=>t.message),r=s;return n.length>0&&(r+=`

> \u26A0\uFE0F \u8F6C\u6362\u8B66\u544A:
${n.map(t=>`> - ${t}`).join(`
`)}`),{content:r}}export{m as parseDocx};
