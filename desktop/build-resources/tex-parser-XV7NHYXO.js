import{b as n}from"./chunk-UCQ6LACX.js";import{readFile as s}from"fs/promises";async function l(e){let t=await s(e,"utf-8"),r=t.split(`
`);return{content:"```latex\n"+t+"\n```",metadata:{lines:r.length}}}var a=n(()=>{});a();export{l as parseLatex};
