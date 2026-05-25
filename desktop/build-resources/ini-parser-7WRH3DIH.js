import"./chunk-DGJUBN33.js";import{readFile as r}from"fs/promises";async function i(e){let t=await r(e,"utf-8");return{content:"```ini\n"+t+"\n```",metadata:{lines:t.split(`
`).length}}}export{i as parseIni};
