
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Edit2, Save, X, Database, Trophy, Upload } from 'lucide-react'
import * as XLSX from 'xlsx'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { getStats, getAdvisorStats, getSurveyRecords, updateSurveyRecord, replaceServiceRanker, replaceDispositionImports, replaceFollowUpImports } from './api'
import { fmt, npsClass, REGION_NPS } from './nps'

const STATUSES = ['Complete','Committed','Unresponsive','Issue','Disposition Only']
const CONTACT_METHODS = ['','Phone','Email','Text','In Person']

function initials(name=''){
  const p=name.trim().split(' ')
  return ((p[0]?.[0]||'')+(p[1]?.[0]||'')).toUpperCase()
}
function statusClass(s){
  if(s==='Complete') return 'b-complete'
  if(s==='Committed') return 'b-committed'
  if(s==='Unresponsive') return 'b-unresponsive'
  if(s==='Issue') return 'b-issue'
  if(s==='Disposition Only') return 'b-disposition'
  return ''
}
function matchClass(s){
  if(s==='Matched') return 'b-match'
  if(s==='Disposition Only') return 'b-missing'
  if(s==='Follow-Up Only') return 'b-follow'
  return ''
}
function parseNum(v){
  const n = Number(String(v ?? '').replace('%','').replace(',','').trim())
  return Number.isFinite(n) ? n : 0
}
function titleCaseAdvisor(name){
  return String(name || '').trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}
function excelDateToIso(value){
  if(!value) return null
  if(value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0,10)
  if(typeof value === 'number'){
    const date = XLSX.SSF.parse_date_code(value)
    if(!date) return null
    return `${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`
  }
  const d = new Date(value)
  if(!Number.isNaN(d.getTime())) return d.toISOString().slice(0,10)
  return null
}
function estimateNpsDistribution(completed, nps){
  const total = Number(completed || 0)
  const net = Math.round((Number(nps || 0) / 100) * total)
  let promoters = 0, detractors = 0, passives = total
  if(net >= 0){ promoters = Math.min(total, net); passives = Math.max(0, total - promoters) }
  else { detractors = Math.min(total, Math.abs(net)); passives = Math.max(0, total - detractors) }
  return { promoters, passives, detractors }
}
function parseCsiWorkbook(workbook){
  const ws = workbook.Sheets['Table1'] || workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  let metrics = { national_score: 86.42, region_score: 83.2, store_nps: 69.23 }
  const advisorRows = []
  for (const row of raw) {
    const name = String(row[0] ?? '').trim()
    const nps = parseNum(row[1])
    const completed = parseNum(row[2])
    const impact = parseNum(row[4])
    if (!name) continue
    const lower = name.toLowerCase()
    if (lower === 'national') { metrics.national_score = nps; continue }
    if (lower === 'ce') { metrics.region_score = nps; continue }
    if (lower === 'mo027' || lower.includes('napleton')) { metrics.store_nps = nps; continue }
    if (lower === 'ce04') continue
    if (!/[a-zA-Z]/.test(name) || completed <= 0) continue
    const dist = estimateNpsDistribution(completed, nps)
    advisorRows.push({ advisor: titleCaseAdvisor(name), nps, completed_surveys: completed, promoters: dist.promoters, passives: dist.passives, detractors: dist.detractors, impact })
  }
  return { advisorRows, metrics }
}
function parseDispositionWorkbook(workbook){
  const ws = workbook.Sheets['Table'] || workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  return rows.map((r) => ({
    ro_number: String(r['RO Number'] ?? '').trim(),
    customer_name: String(r['Customer Name'] ?? '').trim(),
    advisor: titleCaseAdvisor(r['Service Consultant Name'] ?? ''),
    ro_date: excelDateToIso(r['RO Date']),
    survey_status: String(r['Survey Status'] ?? '').trim(),
    response_date: excelDateToIso(r['Response Date']),
    invitation_id: String(r['Invitation ID'] ?? '').trim(),
    survey_id: String(r['Survey Id'] ?? r['Survey ID'] ?? '').trim(),
  })).filter(r => r.ro_number || r.customer_name)
}


function parseFollowUpWorkbook(workbook){
  const ws = workbook.Sheets['Survey Data'] || workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

  return rows.map((r) => {
    const rawStatus = String(r['Status'] ?? '').trim()
    const status = rawStatus || 'Committed'
    const rawRo = String(r['RO #'] ?? '').trim()
    const roNumber = /^\d+$/.test(rawRo) ? rawRo : ''
    const surveyCode = rawRo && !/^\d+$/.test(rawRo) ? rawRo : ''

    const notes = String(r['Notes'] ?? '').trim()
    const followUpDate = excelDateToIso(r['Follow-Up Date'])
    const noteWithFollowUp = [notes, followUpDate ? `Follow-Up Date: ${followUpDate}` : ''].filter(Boolean).join(' | ')

    return {
      customer_name: String(r['Customer Name'] ?? '').trim(),
      status,
      follow_up_category: status,
      survey_code: surveyCode,
      ro_number: roNumber,
      date_contacted: excelDateToIso(r['Contact Date']),
      contact_method: null,
      customer_response: null,
      follow_up_needed: status !== 'Complete',
      manager_notes: noteWithFollowUp || null,
      advisor: titleCaseAdvisor(r['Advisor'] ?? ''),
    }
  }).filter(r => r.customer_name || r.survey_code || r.ro_number)
}

function KpiCards({stats, activeFilter, onFilterChange}){
  if(!stats) return <div className="grid">{Array.from({length:8}).map((_,i)=><div key={i} className="card"><div className="label">Loading</div></div>)}</div>
  const cards = [
    {key:'nps', label:'Store NPS', value:fmt(stats.nps_score), cls:npsClass(stats.nps_score), desc:`Region ${stats.region_score ?? REGION_NPS}`},
    {key:'disposition_total', label:'Disposition Records', value:stats.disposition_total ?? 0, cls:'cyan', desc:'Uploaded Kia invitations'},
    {key:'matched_total', label:'Matched Records', value:stats.matched_total ?? 0, cls:'green', desc:'Disposition + follow-up'},
    {key:'missing_followups', label:'Missing Follow-Ups', value:stats.missing_followups ?? 0, cls:'orange', desc:'Needs advisor attention'},
    {key:'Complete', label:'Complete', value:stats.complete, cls:'green', desc:'Follow-up complete', filter:true},
    {key:'Committed', label:'Committed', value:stats.committed, cls:'blue', desc:'Will respond', filter:true},
    {key:'Unresponsive', label:'Unresponsive', value:stats.unresponsive, cls:'red', desc:'No contact made', filter:true},
    {key:'Issue', label:'Issues', value:stats.issues, cls:'orange', desc:'Needs attention', filter:true},
  ]
  return <div className="grid">{cards.map(c=><div key={c.key} onClick={()=>c.filter && onFilterChange(activeFilter===c.key?'All':c.key)} className="card" style={{cursor:c.filter?'pointer':'default', outline:activeFilter===c.key?'1px solid currentColor':'none'}}>
    <div className="label">{c.label}</div><div className={`value ${c.cls}`}>{c.value}</div><div className="desc">{c.desc}</div>
  </div>)}</div>
}

function AdvisorLeaderboard({advisors=[]}){
  return <div className="panel">
    <div className="panel-head"><div className="panel-title"><Trophy size={16} color="#facc15"/> Advisor Leaderboard</div><div className="small">Ranked by Final CSI / NPS</div></div>
    <table><thead><tr><th>Rank</th><th>Advisor</th><th>Final CSI / NPS</th><th>Completed</th><th>Promoters*</th><th>Passives*</th><th>Detractors*</th><th>Impact</th></tr></thead>
    <tbody>{advisors.map((a,i)=>{
      const cls=npsClass(a.nps_score)
      return <tr key={a.advisor}>
        <td>{i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`}</td>
        <td><div className="advisor-cell"><div className="avatar">{initials(a.advisor)}</div><b>{a.advisor}</b></div></td>
        <td><div className="bar-wrap"><div className="bar-bg"><div className="bar" style={{width:`${Math.max(0,Math.min(100,a.nps_score))}%`, background: cls==='green'?'var(--green)':cls==='orange'?'var(--orange)':'var(--red)'}} /></div><b className={cls}>{fmt(a.nps_score)}</b></div></td>
        <td><span className="pill" style={{background:'rgba(255,255,255,.08)'}}>{a.completed_surveys}</span></td>
        <td><span className="pill green" style={{background:'rgba(52,211,153,.14)'}}>{a.promoters}</span></td>
        <td><span className="pill orange" style={{background:'rgba(251,146,60,.14)'}}>{a.passives}</span></td>
        <td><span className="pill red" style={{background:'rgba(248,113,113,.14)'}}>{a.detractors}</span></td>
        <td className={a.impact>0?'green':a.impact<0?'red':''}>{a.impact>0?`+${a.impact}`:a.impact}</td>
      </tr>
    })}</tbody></table>
    <div className="footer"><span>NPS source: Kia CSI Excel → service_ranker</span><span>*P/P/D estimated unless Kia export includes exact split</span></div>
  </div>
}

function exportRows(rows){
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Follow-Up Center')
  XLSX.writeFile(wb, `NapletonKia_FollowUp_${new Date().toISOString().slice(0,10)}.xlsx`)
}

function FollowUpTable({records,totalRecords,loading,activeFilter,onFilterChange,onSaved}){
  const [search,setSearch]=useState('')
  const [page,setPage]=useState(1)
  const [pageSize,setPageSize]=useState(25)
  const [edit,setEdit]=useState(null)
  const filtered = useMemo(()=>{ const q=search.toLowerCase(); return records.filter(r=>Object.values(r).join(' ').toLowerCase().includes(q)) },[records,search])
  const pageRows=filtered.slice((page-1)*pageSize,page*pageSize)
  const pages=Math.max(1,Math.ceil(filtered.length/pageSize))
  useEffect(()=>setPage(1),[activeFilter, search, pageSize])
  async function save(){ await updateSurveyRecord(edit); setEdit(null); onSaved() }
  const val=(r,k)=> edit?.id===r.id ? edit[k] : r[k]
  const set=(k,v)=>setEdit(e=>({...e,[k]:v}))
  return <div className="panel">
    <div className="panel-head"><div><b>Follow-Up Center</b> <span className="small">{filtered.length} showing</span> <span className="small"><Database size={12}/> {totalRecords.toLocaleString()} total</span></div>
      <div style={{display:'flex',gap:8}}><input className="search" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/><button className="btn" onClick={()=>exportRows(records)}><Download size={14}/> Export</button></div></div>
    <div className="tabs">{['All','Disposition Only','Complete','Committed','Unresponsive','Issue'].map(t=><button key={t} onClick={()=>onFilterChange(t)} className={`tab ${activeFilter===t?'active':''}`}>{t==='All'?'All Records':t}</button>)}</div>
    <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Advisor</th><th>Status</th><th>Disposition Match</th><th>Commitment</th><th>RO Number</th><th>Survey Status</th><th>Response Date</th><th>Date Contacted</th><th>Contact Method</th><th>Customer Response</th><th>Follow Up</th><th>Manager Notes</th><th></th></tr></thead>
    <tbody>{loading?<tr><td colSpan="14">Loading...</td></tr>:pageRows.map(r=>{
      const editing=edit?.id===r.id
      const status=val(r,'follow_up_category') || r.status
      return <tr key={r.id} className={r.synthetic ? 'synthetic-row' : ''}>
        <td><b>{r.customer_name}</b></td><td>{r.advisor}</td>
        <td>{editing?<select value={status||''} onChange={e=>set('follow_up_category',e.target.value)}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select>:<span className={`badge ${statusClass(status)}`}>{status}</span>}</td>
        <td><span className={`badge ${matchClass(r.disposition_match)}`}>{r.disposition_match || '—'}</span></td>
        <td>{r.commitment_status || '—'}</td>
        <td>{r.ro_number||'—'}</td>
        <td>{r.disposition_survey_status||'—'}</td>
        <td>{r.response_date||'—'}</td>
        <td>{editing?<input type="date" value={val(r,'date_contacted')||''} onChange={e=>set('date_contacted',e.target.value)}/>:r.date_contacted||'—'}</td>
        <td>{editing?<select value={val(r,'contact_method')||''} onChange={e=>set('contact_method',e.target.value)}>{CONTACT_METHODS.map(s=><option key={s}>{s}</option>)}</select>:r.contact_method||'—'}</td>
        <td>{editing?<textarea value={val(r,'customer_response')||''} onChange={e=>set('customer_response',e.target.value)}/>:r.customer_response||'—'}</td>
        <td>{editing?<input type="checkbox" checked={!!val(r,'follow_up_needed')} onChange={e=>set('follow_up_needed',e.target.checked)}/>:r.follow_up_needed?'Yes':'No'}</td>
        <td>{editing?<textarea value={val(r,'manager_notes')||''} onChange={e=>set('manager_notes',e.target.value)}/>:r.manager_notes||'—'}</td>
        <td>{r.synthetic ? <span className="small">Needs follow-up</span> : editing?<div className="row-actions"><button className="btn" onClick={save}><Save size={14}/> Save</button><button className="btn" onClick={()=>setEdit(null)}><X size={14}/></button></div>:<button className="btn" onClick={()=>setEdit({...r})}><Edit2 size={14}/> Edit</button>}</td>
      </tr>
    })}</tbody></table></div>
    <div className="footer"><span>{filtered.length} records {activeFilter!=='All'?`· filtered by "${activeFilter}"`:''}</span><span><select value={pageSize} onChange={e=>setPageSize(Number(e.target.value))}>{[10,25,50,100].map(s=><option key={s}>{s}</option>)}</select> <button className="btn" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Prev</button> Page {page} of {pages} <button className="btn" disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>Next</button></span></div>
  </div>
}

function App(){
  const [stats,setStats]=useState(null)
  const [advisors,setAdvisors]=useState([])
  const [records,setRecords]=useState([])
  const [total,setTotal]=useState(0)
  const [filter,setFilter]=useState('All')
  const [loading,setLoading]=useState(true)
  const [err,setErr]=useState('')
  const [importStatus,setImportStatus]=useState('')
  const csiFileRef = useRef(null)
  const dispositionFileRef = useRef(null)
  const followUpFileRef = useRef(null)

  async function refresh(currentFilter=filter){
    try{
      setErr('')
      setLoading(true)
      const [s,a,r] = await Promise.all([getStats(), getAdvisorStats(), getSurveyRecords(currentFilter)])
      setStats(s); setAdvisors(a); setRecords(r.rows); setTotal(r.total)
    }catch(e){ console.error(e); setErr(e.message || String(e)) }
    finally{ setLoading(false) }
  }
  useEffect(()=>{refresh('All')},[])
  async function changeFilter(f){ setFilter(f); await refresh(f) }

  async function handleCsiUpload(e){
    const file = e.target.files?.[0]
    if(!file) return
    try{
      setImportStatus('Reading CSI report...')
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const { advisorRows, metrics } = parseCsiWorkbook(workbook)
      if(!advisorRows.length) throw new Error('No advisor rows found. Please use the Kia Service Ranker Excel export.')
      setImportStatus(`Importing ${advisorRows.length} advisor rows...`)
      await replaceServiceRanker(advisorRows, metrics)
      setImportStatus(`Imported CSI: ${advisorRows.length} advisors. Store NPS ${metrics.store_nps}.`)
      await refresh(filter)
    }catch(error){ console.error(error); setImportStatus(`Import failed: ${error.message || error}`) }
    finally{ if(csiFileRef.current) csiFileRef.current.value = '' }
  }

  async function handleDispositionUpload(e){
    const file = e.target.files?.[0]
    if(!file) return
    try{
      setImportStatus('Reading disposition report...')
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
      const rows = parseDispositionWorkbook(workbook)
      if(!rows.length) throw new Error('No disposition rows found. Please use the Kia Service Invitation List export.')
      setImportStatus(`Importing ${rows.length} disposition records...`)
      await replaceDispositionImports(rows)
      setImportStatus(`Imported ${rows.length} disposition records and matched them against follow-ups.`)
      await refresh(filter)
    }catch(error){ console.error(error); setImportStatus(`Disposition import failed: ${error.message || error}`) }
    finally{ if(dispositionFileRef.current) dispositionFileRef.current.value = '' }
  }


  async function handleFollowUpUpload(e){
    const file = e.target.files?.[0]
    if(!file) return
    try{
      setImportStatus('Reading follow-up list...')
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
      const rows = parseFollowUpWorkbook(workbook)
      if(!rows.length) throw new Error('No follow-up rows found. Please use the Napleton Kia Survey List Excel file.')
      setImportStatus(`Importing ${rows.length} follow-up records...`)
      await replaceFollowUpImports(rows)
      setImportStatus(`Imported ${rows.length} follow-up records and compared them against the disposition list.`)
      await refresh(filter)
    }catch(error){ console.error(error); setImportStatus(`Follow-up import failed: ${error.message || error}`) }
    finally{ if(followUpFileRef.current) followUpFileRef.current.value = '' }
  }

  return <div>
    <header className="header">
      <div className="brand"><div className="logo">KIA</div><div><b>NAPLETON KIA MID RIVERS</b><div className="small">Service Performance Dashboard</div></div></div>
      <div className="admin-import">
        <input ref={csiFileRef} className="hidden-file" type="file" accept=".xlsx,.xls,.csv" onChange={handleCsiUpload} />
        <input ref={dispositionFileRef} className="hidden-file" type="file" accept=".xlsx,.xls,.csv" onChange={handleDispositionUpload} />
        <input ref={followUpFileRef} className="hidden-file" type="file" accept=".xlsx,.xls,.csv" onChange={handleFollowUpUpload} />
        <button className="btn import-btn" onClick={()=>csiFileRef.current?.click()}><Upload size={14}/> Upload CSI Report</button>
        <button className="btn import-btn secondary" onClick={()=>dispositionFileRef.current?.click()}><Upload size={14}/> Upload Disposition Report</button>
        <button className="btn import-btn followup" onClick={()=>followUpFileRef.current?.click()}><Upload size={14}/> Upload Follow-Up List</button>
        {importStatus && <span className="import-status">{importStatus}</span>}
      </div>
    </header>
    <main className="container">
      {err&&<div className="card red">Error: {err}</div>}
      <KpiCards stats={stats} activeFilter={filter} onFilterChange={changeFilter}/>
      <AdvisorLeaderboard advisors={advisors}/>
      <FollowUpTable records={records} totalRecords={total} loading={loading} activeFilter={filter} onFilterChange={changeFilter} onSaved={()=>refresh(filter)}/>
    </main>
  </div>
}
createRoot(document.getElementById('root')).render(<App />)
