import"./chunk-DGJUBN33.js";import{readFile as n}from"fs/promises";async function a(e){let t=await n(e,"utf-8"),r=t.split(`
`);return{content:"```latex\n"+t+"\n```",metadata:{lines:r.length}}}export{a as parseLatex};
