import"./chunk-DGJUBN33.js";import{readFile as r}from"fs/promises";async function s(e){let t=await r(e,"utf-8");return{content:"```toml\n"+t+"\n```",metadata:{lines:t.split(`
`).length}}}export{s as parseToml};
