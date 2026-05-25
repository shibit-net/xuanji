import"./chunk-DGJUBN33.js";import{execFile as S}from"child_process";import{promisify as _}from"util";import*as l from"xlsx";var m=_(S),w={cellDates:!0,dateNF:"yyyy-mm-dd",dense:!1,type:"file"};function X(e,n){let r=e.SheetNames,t=[];t.push(`[${n}] ${e.Props?.Title||""}`),t.push(`${r.length} sheet(s): ${r.join(", ")}`),t.push("");for(let o of r){let s=e.Sheets[o];t.push(P(s,o))}return{content:t.join(`
`)}}function P(e,n,r=200){let t=[],o=e["!ref"];if(!o)return`> Sheet "${n}": \u7A7A

`;let s=l.utils.decode_range(o),p=s.e.r-s.s.r+1,d=s.e.c-s.s.c+1;t.push(`### ${n} (${p} \u884C \xD7 ${d} \u5217)`),t.push("");let h=l.utils.sheet_to_json(e,{header:1,defval:"",raw:!1});if(h.length===0)return t.push(`(\u7A7A)
`),t.join(`
`);let f=h[0]??[],c=f.length,u=h.slice(0,r+1);t.push("| "+f.map(i=>String(i??"")).join(" | ")+" |"),t.push("| "+Array(c).fill("---").join(" | ")+" |");for(let i=1;i<u.length;i++){let y=u[i];t.push("| "+Array.from({length:c},(L,g)=>String(y[g]??"")).join(" | ")+" |")}return p>r&&(t.push(""),t.push(`> ... \u8FD8\u6709 ${p-r} \u884C\u672A\u663E\u793A\u3002`)),t.push(""),t.join(`
`)}var x=`
import sys, os, pandas as pd
filepath = sys.argv[1]
max_rows = 200
try:
    sheets = pd.read_excel(filepath, sheet_name=None, engine='xlrd')
except Exception as e:
    print(f"[XLS Error] {e}", file=sys.stderr)
    sys.exit(1)
print(f"[EXCEL] {os.path.basename(filepath)}")
print(f"{len(sheets)} sheet(s): {', '.join(sheets.keys())}")
print()
for name, df in sheets.items():
    total_rows, total_cols = df.shape
    print(f"### {name} ({total_rows} \u884C x {total_cols} \u5217)")
    print()
    if df.empty:
        print("(\u7A7A)")
        print()
        continue
    display = df.head(max_rows)
    headers = [str(h) for h in display.columns.tolist()]
    print('| ' + ' | '.join(headers) + ' |')
    print('| ' + ' | '.join(['---'] * len(headers)) + ' |')
    for _, row in display.iterrows():
        vals = [str(v) if pd.notna(v) else '' for v in row]
        print('| ' + ' | '.join(vals) + ' |')
    if total_rows > max_rows:
        print()
        print(f"> ... \u8FD8\u6709 {total_rows - max_rows} \u884C\u672A\u663E\u793A\u3002")
    print()
`.trim(),a=null;async function j(){if(a!==null)return a;try{await m("python3",["--version"],{timeout:5e3}),a=!0}catch{a=!1}return a}async function v(e){let{stdout:n,stderr:r}=await m("python3",["-c",x,e],{timeout:3e4,maxBuffer:10485760});if(r)throw new Error(r.trim());return{content:n.trim()}}async function $(e){try{let n=l.readFile(e,w);if(n.SheetNames.length>0)return X(n,"EXCEL")}catch{}if(!await j())throw new Error(`\u65E0\u6CD5\u89E3\u6790 .xls \u6587\u4EF6\uFF1ASheetJS \u4E0D\u652F\u6301\u6B64\u683C\u5F0F\uFF0C\u4E14\u7CFB\u7EDF\u672A\u5B89\u88C5 Python 3\u3002
\u8BF7\u5B89\u88C5 Python 3 (brew install python3) \u540E\u518D\u8BD5\u3002`);return v(e)}export{$ as parseXls};
