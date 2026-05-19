import{b as a}from"./chunk-UCQ6LACX.js";import{readFile as o}from"fs/promises";function i(r){if(r.charCodeAt(0)!==123)throw new Error("\u65E0\u6CD5\u89E3\u6790\u7684 RTF \u683C\u5F0F");let e=r;return e=e.replace(/\\u(\d+)/g,(t,n)=>String.fromCharCode(parseInt(n,10))),e=e.replace(/\\([a-z]+)(-?\d+)?/gi,""),e=e.replace(/[{}]/g,""),e=e.replace(/\\'[0-9a-f]{2}/gi,""),e=e.replace(/\s+/g," ").replace(/\n\s*\n/g,`

`).trim(),e}async function l(r){let e=await o(r,"utf-8"),t=i(e);return{content:t,metadata:{charCount:t.length}}}var s=a(()=>{});s();export{l as parseRtf};
