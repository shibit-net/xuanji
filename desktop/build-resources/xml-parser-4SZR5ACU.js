import{b as o}from"./chunk-UCQ6LACX.js";import{readFile as c}from"fs/promises";function f(a){let l="",i=0,t=[],r=a.replace(/>\s+</g,"><").replace(/<!--[\s\S]*?-->/g,"").trim(),s=0;for(;s<r.length;)if(r[s]==="<"){let n=r.indexOf(">",s);if(n===-1)break;let e=r.slice(s,n+1);e.startsWith("</")?(i=Math.max(0,i-1),t.push("  ".repeat(i)+e)):e.endsWith("/>")||e.startsWith("<!")?t.push("  ".repeat(i)+e):(t.push("  ".repeat(i)+e),i++),s=n+1}else{let n=r.indexOf("<",s),e=n===-1?r.slice(s):r.slice(s,n);e.trim()&&t.push("  ".repeat(i)+e.trim()),s=n===-1?r.length:n}if(t.length>500){let n=t.slice(0,200),e=t.slice(t.length-100);l=n.join(`
`)+`

... [${t.length-300} lines omitted] ...

`+e.join(`
`)}else l=t.join(`
`);return l}async function h(a){let l=await c(a,"utf-8");return{content:"```xml\n"+f(l)+"\n```"}}var m=o(()=>{});m();export{h as parseXml};
