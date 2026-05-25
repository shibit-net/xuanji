import"./chunk-DGJUBN33.js";import{execFile as S}from"child_process";import{existsSync as c}from"fs";import{promisify as v}from"util";import*as a from"xlsx";import l from"path";var h=v(S),X={cellDates:!0,dateNF:"yyyy-mm-dd",dense:!1,type:"file"};function w(n,r){let e=n.SheetNames,t=[`[${r}] ${n.Props?.Title||""}`,`${e.length} sheet(s): ${e.join(", ")}`,""];for(let s of e)t.push(x(n.Sheets[s],s));return{content:t.join(`
`)}}function x(n,r,e=200){let t=[],s=n["!ref"];if(!s)return`> Sheet "${r}": \u7A7A

`;let o=a.utils.decode_range(s),p=o.e.r-o.s.r+1,_=o.e.c-o.s.c+1;t.push(`### ${r} (${p} \u884C x ${_} \u5217)`,"");let f=a.utils.sheet_to_json(n,{header:1,defval:"",raw:!1});if(f.length===0)return t.concat(`(\u7A7A)
`).join(`
`);let u=f[0]??[],m=u.length,d=f.slice(0,e+1);t.push("| "+u.map(i=>String(i??"")).join(" | ")+" |"),t.push("| "+Array(m).fill("---").join(" | ")+" |");for(let i=1;i<d.length;i++){let g=d[i];t.push("| "+Array.from({length:m},(P,L)=>String(g[L]??"")).join(" | ")+" |")}return p>e&&t.push("",`> ... \u8FD8\u6709 ${p-e} \u884C\u672A\u663E\u793A\u3002`),t.push(""),t.join(`
`)}function E(){let n=process.env.XUANJI_PYTHON_RUNTIME;if(!n)return null;let r=l.join(n,"xls-convert.py"),e=[l.join(n,"python","bin","python3"),l.join(n,"python","bin","python3.12"),l.join(n,"bin","python3")];for(let t of e)if(c(t)&&c(r))return{python:t,script:r};for(let t of candidates)if(c(t.python)&&c(t.script))return t;return null}async function y(n){try{return await h(n,["--version"],{timeout:5e3}),!0}catch{return!1}}var b=`
import sys, os, xlrd
fp = sys.argv[1]
wb = xlrd.open_workbook(fp)
print(f"[EXCEL] {os.path.basename(fp)}")
print(f"{len(wb.sheet_names())} sheet(s): {', '.join(wb.sheet_names())}")
print()
for name in wb.sheet_names():
    sh = wb.sheet_by_name(name)
    nr, nc = sh.nrows, sh.ncols
    print(f"### {name} ({nr} \u884C x {nc} \u5217)")
    print()
    if nr == 0:
        print("(\u7A7A)")
        print()
        continue
    maxr = min(nr, 201)
    hdr = [str(sh.cell_value(0, c)) for c in range(nc)]
    print('| ' + ' | '.join(hdr) + ' |')
    print('| ' + ' | '.join(['---'] * nc) + ' |')
    for r in range(1, maxr):
        vals = []
        for c in range(nc):
            ct = sh.cell_type(r, c)
            v = sh.cell_value(r, c)
            if ct == xlrd.XL_CELL_DATE:
                dt = xlrd.xldate_as_datetime(v, wb.datemode)
                v = dt.strftime('%Y-%m-%d' if dt.hour == 0 else '%Y-%m-%d %H:%M:%S')
            elif ct == xlrd.XL_CELL_BOOLEAN:
                v = 'TRUE' if v else 'FALSE'
            elif ct == xlrd.XL_CELL_EMPTY:
                v = ''
            elif ct == xlrd.XL_CELL_NUMBER and v == int(v):
                v = str(int(v))
            vals.append(str(v))
        print('| ' + ' | '.join(vals) + ' |')
    if nr - 1 > 200:
        print()
        print(f"> ... \u8FD8\u6709 {nr - 1 - 200} \u884C\u672A\u663E\u793A\u3002")
    print()
`.trim();async function j(n){let r=E();if(r&&await y(r.python)){let{stdout:s,stderr:o}=await h(r.python,[r.script,n],{timeout:3e4,maxBuffer:10485760});if(!o)return{content:s.trim()};throw new Error(o.trim())}if(!await y("python3"))throw new Error(`\u65E0\u6CD5\u89E3\u6790 .xls \u6587\u4EF6\uFF1ASheetJS \u4E0D\u652F\u6301\u6B64\u683C\u5F0F\uFF0C\u4E14\u7CFB\u7EDF\u672A\u68C0\u6D4B\u5230 Python 3\u3002
\u8BF7\u5B89\u88C5 Python 3 (brew install python3) \u548C xlrd (pip3 install xlrd) \u540E\u518D\u8BD5\u3002`);let{stdout:e,stderr:t}=await h("python3",["-c",b,n],{timeout:3e4,maxBuffer:10*1024*1024});if(t)throw new Error(t.trim());return{content:e.trim()}}async function $(n){try{let r=a.readFile(n,X);if(r.SheetNames.length>0)return w(r,"EXCEL")}catch{}return j(n)}export{$ as parseXls};
