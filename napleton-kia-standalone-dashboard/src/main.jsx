import React, { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as XLSX from 'xlsx'
import { UploadCloud, FileSpreadsheet, FileText, CheckCircle2, AlertTriangle, RefreshCw, Database, Activity, Search, BarChart3, Settings, Trash2, Eye, Sparkles, Clock3, Archive, ShieldCheck } from 'lucide-react'
import './styles.css'

const KNOWN_REPORTS = [
  { key:'open_ro', label:'Open RO', category:'Operations', freshness:'Daily', words:['open ro','repair order','ro #','ro open date','promised date','advisor','technician','customer','vehicle'] },
  { key:'pre_invoice', label:'Pre-Invoice / Ready to Post', category:'Operations', freshness:'Daily', words:['pre inv','preinvoice','ready to post','ready to post','ro status'] },
  { key:'rentals', label:'Rental Report', category:'Operations', freshness:'Daily', words:['rental','loaner','days in rental','ro number','customer'] },
  { key:'pace', label:'PACE', category:'Financial', freshness:'Daily', words:['pace','mtd','gross','cp','warranty','internal','elr','advisor'] },
  { key:'tech_hours', label:'Tech Hours', category:'Technician', freshness:'Daily', words:['tech hours','technician','hours','efficiency','frh','wage','employee number','new employee'] },
  { key:'customer_pay', label:'Closed Customer Pay', category:'Financial', freshness:'Daily', words:['closed june cp','customer pay','cp','labor sale','parts sale','gross'] },
  { key:'warranty', label:'Closed Warranty', category:'Financial', freshness:'Daily', words:['closed june wrty','warranty','wrty','labor','parts','gross'] },
  { key:'internal', label:'Closed Internal', category:'Financial', freshness:'Daily', words:['closed june int','internal','labor','parts','gross'] },
  { key:'discounts', label:'Discount / Policy', category:'Financial', freshness:'Weekly', words:['disc','discount','policy','adjustment'] },
  { key:'jv_sheet', label:'JV Sheet', category:'Financial', freshness:'Weekly', words:['jv sheet','journal','warranty adjustment','mid rivers kia jv'] },
  { key:'spo', label:'SPO / Parts Filled', category:'Parts', freshness:'Daily', words:['spo','special order','filled','parts'] },
  { key:'service_invitations', label:'Service Invitations', category:'Customer Experience', freshness:'Daily', words:['serviceinvitationlistreport','service invitation','invitation','disposition','customer','survey'] },
  { key:'survey_detail', label:'Survey Detail', category:'Customer Experience', freshness:'Daily', words:['servicesurveydetailaggregatereport','survey detail','aggregate','nps','csi','completed','score'] },
  { key:'service_ranker', label:'Service Ranker', category:'Customer Experience', freshness:'Daily', words:['serviceranker','service ranker','ranker','nps','ranking'] },
  { key:'program_health', label:'Program Health', category:'Customer Experience', freshness:'Daily', words:['programhealth','program health','widget_programhealth','health'] },
  { key:'rank_table', label:'Service Rank Table', category:'Customer Experience', freshness:'Daily', words:['ranktable','rank table','widget_ranktable','rank'] },
  { key:'technician_view', label:'Technician View', category:'Technician', freshness:'Weekly', words:['technician view','dealer view','coverage opportunities','technician leaderboard'] },
  { key:'dealer_view', label:'Dealer View', category:'Executive', freshness:'Weekly', words:['dealer view','coverage opportunities','technician view'] },
  { key:'coverage', label:'Coverage Opportunities', category:'Sales Opportunity', freshness:'Weekly', words:['coverage opportunities','coverage','opportunities'] },
  { key:'techline', label:'KDealer Techline Cases', category:'Warranty', freshness:'Daily', words:['kdealerplus','techline','techlinecases','case','vin','status'] },
  { key:'sunbit_pdf', label:'Sunbit Advisor Analysis', category:'Finance Option', freshness:'Weekly', words:['sunbit','advisor analysis','applications','approvals','purchase amount','conversion'] },
  { key:'owner_pdf', label:'Owner Weekly / ALL Report', category:'Executive', freshness:'Weekly', words:['all_','owner','fixed ops','reputation','service mtd','labor margin','parts margin','policy','shop supplies'] },
  { key:'fixed_ops_pdf', label:'Fixed Ops Summary PDF', category:'Executive', freshness:'Weekly', words:['fixed ops','summary','pace','forecast','labor margin','parts margin'] },
]

const STORAGE_KEY = 'midRiversServiceOS.imports.v81'

function money(n){ return Number(n||0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0}) }
function fmtDate(ts){ return ts ? new Date(ts).toLocaleString() : 'Never' }
function clean(v){ return String(v ?? '').toLowerCase().replace(/[^a-z0-9#%$ ._-]/g,' ').replace(/\s+/g,' ').trim() }
function fileExt(name){ return String(name).split('.').pop().toLowerCase() }
function bytes(n){ if(n>1024*1024) return `${(n/1024/1024).toFixed(1)} MB`; if(n>1024) return `${(n/1024).toFixed(0)} KB`; return `${n} B` }

function scoreReport(report, text, file){
  const hay = `${clean(file.name)} ${text}`
  let score = 0
  let hits = []
  report.words.forEach(w => { if(hay.includes(clean(w))){ score += w.length > 10 ? 16 : 10; hits.push(w) } })
  if(file.type === 'application/pdf' || fileExt(file.name)==='pdf'){
    if(report.key.includes('pdf') || report.key === 'sunbit_pdf' || report.key === 'owner_pdf' || report.key === 'fixed_ops_pdf') score += 20
    else score -= 10
  }
  return { ...report, score, hits }
}

async function parseExcel(file){
  const ab = await file.arrayBuffer()
  const wb = XLSX.read(ab, { type:'array', cellDates:true, dense:false })
  const sheets = wb.SheetNames
  let textChunks = []
  let previews = []
  let totalRows = 0
  for(const sheetName of sheets.slice(0,8)){
    const ws = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:false, blankrows:false })
    totalRows += rows.length
    const sampleRows = rows.slice(0,12)
    textChunks.push(clean(sheetName), ...sampleRows.flat().map(clean))
    if(previews.length < 2){
      const nonEmpty = rows.filter(r => r.some(c => String(c).trim() !== '')).slice(0,6)
      previews.push({ sheetName, rows: nonEmpty })
    }
  }
  return { kind:'excel', sheets, text: clean(textChunks.join(' ')), rowCount:totalRows, previews }
}

async function inspectFile(file){
  const ext = fileExt(file.name)
  const base = { id:`${file.name}-${file.size}-${file.lastModified}`, name:file.name, size:file.size, modified:file.lastModified, ext, addedAt:Date.now() }
  try{
    let parsed
    if(['xlsx','xls','csv'].includes(ext)) parsed = await parseExcel(file)
    else if(ext === 'pdf') parsed = { kind:'pdf', sheets:[], text: clean(file.name), rowCount:null, previews:[] }
    else parsed = { kind:'unknown', sheets:[], text: clean(file.name), rowCount:null, previews:[] }
    const ranked = KNOWN_REPORTS.map(r => scoreReport(r, parsed.text, file)).sort((a,b)=>b.score-a.score)
    const best = ranked[0]
    const confidence = best.score >= 55 ? 'High' : best.score >= 28 ? 'Medium' : best.score >= 15 ? 'Low' : 'Unknown'
    const status = confidence === 'Unknown' ? 'warning' : 'ready'
    return { ...base, ...parsed, detected: confidence === 'Unknown' ? null : best, confidence, status, ranked: ranked.slice(0,3) }
  }catch(err){
    return { ...base, kind:'error', text:'', rowCount:null, previews:[], detected:null, confidence:'Error', status:'error', error:String(err?.message || err) }
  }
}

function useImportStore(){
  const [history,setHistory] = useState(()=>{
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
  })
  const save = (next) => { setHistory(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) }
  return { history, save }
}

function KPI({label,value,sub,icon:Icon,tone}){ return <div className={`kpi ${tone||''}`}><div><span>{label}</span><b>{value}</b><em>{sub}</em></div>{Icon && <Icon size={25}/>}</div> }

function App(){
  const { history, save } = useImportStore()
  const [active,setActive] = useState('command')
  const [queue,setQueue] = useState([])
  const [processing,setProcessing] = useState(false)
  const [drag,setDrag] = useState(false)
  const inputRef = useRef(null)

  const latestByType = useMemo(()=>{
    const map = {}
    history.forEach(h => { if(h.detected?.key && (!map[h.detected.key] || h.appliedAt > map[h.detected.key].appliedAt)) map[h.detected.key] = h })
    return map
  },[history])

  const stats = useMemo(()=>{
    const today = new Date().toDateString()
    const todayImports = history.filter(h=>new Date(h.appliedAt).toDateString()===today).length
    const reportTypes = Object.keys(latestByType).length
    const stale = KNOWN_REPORTS.filter(r => !latestByType[r.key]).length
    const latest = history[0]
    return { todayImports, reportTypes, stale, latest }
  },[history,latestByType])

  async function addFiles(files){
    setProcessing(true)
    const list = Array.from(files || [])
    const inspected = []
    for(const f of list){ inspected.push(await inspectFile(f)) }
    setQueue(q => [...inspected, ...q])
    setProcessing(false)
    setActive('imports')
  }

  function applyImports(){
    const ready = queue.filter(x => x.status === 'ready')
    const applied = ready.map(item => {
      const duplicate = history.some(h => h.id === item.id)
      const replaced = item.detected?.key ? history.some(h => h.detected?.key === item.detected.key) : false
      return { ...item, appliedAt: Date.now(), duplicate, replaced }
    })
    save([...applied, ...history].slice(0,500))
    setQueue(q => q.filter(x => x.status !== 'ready'))
  }

  function clearHistory(){ if(confirm('Clear import history on this browser?')) save([]) }

  return <div className="app">
    <div className="watermark">KIA</div>
    <header className="topbar glass">
      <div className="brand"><div className="brand-mark">MR</div><div><b>MID RIVERS KIA SERVICEOS</b><span>Service Director Workspace</span></div></div>
      <nav>
        <button className={active==='command'?'on':''} onClick={()=>setActive('command')}>Command Center</button>
        <button className={active==='imports'?'on':''} onClick={()=>setActive('imports')}>Import Center</button>
        <button className={active==='library'?'on':''} onClick={()=>setActive('library')}>Report Library</button>
      </nav>
      <div className="search"><Search size={17}/><span>Search RO, advisor, tech...</span></div>
    </header>

    <main className="shell">
      {active==='command' && <section className="page">
        <div className="hero glass">
          <div><p className="eyebrow"><Sparkles size={15}/> COMMAND CENTER</p><h1>Good evening, Billy</h1><p className="muted">Drop reports into the web Import Center. No renaming, no folder sync, no PowerShell.</p></div>
          <div className="hero-score"><span>Import Health</span><b>{Math.max(0, Math.round((stats.reportTypes / KNOWN_REPORTS.length) * 100))}</b><em>{stats.reportTypes} source types active</em></div>
        </div>
        <div className="kpi-grid">
          <KPI label="Imports Today" value={stats.todayImports} sub="applied in this browser" icon={UploadCloud} tone="blue" />
          <KPI label="Report Types Loaded" value={stats.reportTypes} sub={`${KNOWN_REPORTS.length} known connectors`} icon={Database} tone="green" />
          <KPI label="Last Import" value={stats.latest ? fmtDate(stats.latest.appliedAt).split(',')[1]?.trim() || 'Today' : 'None'} sub={stats.latest?.detected?.label || 'Waiting for files'} icon={Clock3} tone="purple" />
          <KPI label="Missing Sources" value={stats.stale} sub="not imported yet" icon={AlertTriangle} tone="orange" />
        </div>
        <div className="grid-2">
          <div className="panel glass"><div className="panel-head"><h2>Graph Studio Foundation</h2><span>Ready for data engine</span></div><div className="fake-chart"><div></div><div></div><div></div><div></div><div></div><svg viewBox="0 0 700 220" preserveAspectRatio="none"><path d="M0 150 C80 90 150 130 230 70 S420 145 510 80 S630 50 700 105"/><path className="line2" d="M0 170 C90 150 145 165 240 120 S390 80 500 135 S640 100 700 55"/></svg></div></div>
          <div className="panel glass"><div className="panel-head"><h2>Latest Imports</h2><button onClick={()=>setActive('imports')}>Open Import Center</button></div><div className="feed">{history.slice(0,7).map(h=><div className="feed-row" key={h.id+h.appliedAt}><CheckCircle2/><div><b>{h.detected?.label || 'Unknown'}</b><span>{h.name}</span></div><em>{fmtDate(h.appliedAt)}</em></div>)}{!history.length && <div className="empty">No reports imported yet.</div>}</div></div>
        </div>
      </section>}

      {active==='imports' && <section className="page">
        <div className="title-row"><div><p className="eyebrow"><UploadCloud size={15}/> SMART IMPORT CENTER</p><h1>Drop files here in any order</h1><p className="muted">Excel, CSV, and PDF files are identified by file contents when possible, and by PDF/file signatures when needed.</p></div><button className="primary" onClick={()=>inputRef.current?.click()}><UploadCloud size={18}/> Choose Files</button><input ref={inputRef} type="file" multiple className="hidden" accept=".xlsx,.xls,.csv,.pdf" onChange={e=>addFiles(e.target.files)}/></div>
        <div className={`dropzone glass ${drag?'drag':''}`} onDragEnter={e=>{e.preventDefault();setDrag(true)}} onDragOver={e=>e.preventDefault()} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);addFiles(e.dataTransfer.files)}} onClick={()=>inputRef.current?.click()}>
          <UploadCloud size={54}/><h2>Drop one report or the whole batch</h2><p>Do not rename anything. Files from CDK, Kia widgets, Sunbit, KDealer, or owner emails can all go here.</p>{processing && <div className="scanner"><RefreshCw className="spin"/> Reading files...</div>}
        </div>
        {!!queue.length && <div className="panel glass"><div className="panel-head"><h2>Import Queue</h2><div className="actions"><button onClick={()=>setQueue([])}>Clear Queue</button><button className="primary" onClick={applyImports}>Apply {queue.filter(q=>q.status==='ready').length} Imports</button></div></div><div className="cards">{queue.map((item,idx)=><ImportCard item={item} key={item.id+idx}/>)}</div></div>}
        <div className="panel glass"><div className="panel-head"><h2>Import History</h2><button onClick={clearHistory}><Trash2 size={15}/> Clear</button></div><ImportHistory history={history}/></div>
      </section>}

      {active==='library' && <section className="page"><div className="title-row"><div><p className="eyebrow"><Archive size={15}/> REPORT LIBRARY</p><h1>Known report connectors</h1><p className="muted">This is the map the dashboard uses to recognize files without renaming them.</p></div></div><div className="library-grid">{KNOWN_REPORTS.map(r => <div className="library-card glass" key={r.key}><div><b>{r.label}</b><span>{r.category}</span></div><em>{r.freshness}</em><p>{latestByType[r.key] ? `Last imported: ${fmtDate(latestByType[r.key].appliedAt)}` : 'Not imported yet'}</p><i className={latestByType[r.key]?'healthy':'missing'}>{latestByType[r.key]?'Healthy':'Waiting'}</i></div>)}</div></section>}
    </main>
  </div>
}

function ImportCard({item}){
  const Icon = item.ext === 'pdf' ? FileText : FileSpreadsheet
  return <div className={`import-card ${item.status}`}>
    <div className="file-icon"><Icon size={24}/></div>
    <div className="import-main"><div className="import-top"><b>{item.detected?.label || 'Unknown file'}</b><span className={`confidence ${item.confidence.toLowerCase()}`}>{item.confidence}</span></div><p>{item.name}</p><div className="meta"><span>{bytes(item.size)}</span><span>{item.kind}</span>{item.rowCount!=null && <span>{item.rowCount} rows scanned</span>}{item.sheets?.length>0 && <span>{item.sheets.length} sheets</span>}</div>{item.error && <div className="error">{item.error}</div>}{item.detected?.hits?.length>0 && <div className="hits">Matched: {item.detected.hits.slice(0,5).join(', ')}</div>}{item.ranked?.length>1 && <details><summary><Eye size={14}/> detection options</summary>{item.ranked.map(r=><div className="rank" key={r.key}><span>{r.label}</span><b>{r.score}</b></div>)}</details>}{item.previews?.[0] && <details><summary>Preview rows</summary><table className="preview"><tbody>{item.previews[0].rows.map((r,i)=><tr key={i}>{r.slice(0,8).map((c,j)=><td key={j}>{String(c).slice(0,60)}</td>)}</tr>)}</tbody></table></details>}</div>
  </div>
}

function ImportHistory({history}){
  if(!history.length) return <div className="empty">No imports applied yet. Drop files above and click Apply Imports.</div>
  return <div className="history-table"><table><thead><tr><th>Status</th><th>Report</th><th>File</th><th>Applied</th><th>Rows</th><th>Notes</th></tr></thead><tbody>{history.slice(0,80).map((h,i)=><tr key={h.id+h.appliedAt+i}><td><ShieldCheck className="ok" size={17}/></td><td>{h.detected?.label}</td><td>{h.name}</td><td>{fmtDate(h.appliedAt)}</td><td>{h.rowCount ?? 'PDF'}</td><td>{h.duplicate ? 'Duplicate file' : h.replaced ? 'Replaced previous report type' : 'New source'}</td></tr>)}</tbody></table></div>
}

createRoot(document.getElementById('root')).render(<App />)
