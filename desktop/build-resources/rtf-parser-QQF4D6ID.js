import"./chunk-DGJUBN33.js";import{readFile as a}from"fs/promises";function o(r){if(r.charCodeAt(0)!==123)throw new Error("\u65E0\u6CD5\u89E3\u6790\u7684 RTF \u683C\u5F0F");let e=r;return e=e.replace(/\\u(\d+)/g,(t,n)=>String.fromCharCode(parseInt(n,10))),e=e.replace(/\\([a-z]+)(-?\d+)?/gi,""),e=e.replace(/[{}]/g,""),e=e.replace(/\\'[0-9a-f]{2}/gi,""),e=e.replace(/\s+/g," ").replace(/\n\s*\n/g,`

`).trim(),e}async function s(r){let e=await a(r,"utf-8"),t=o(e);return{content:t,metadata:{charCount:t.length}}}export{s as parseRtf};
