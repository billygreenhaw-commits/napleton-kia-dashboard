
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Edit2, Save, X, Database, Trophy, Upload } from 'lucide-react'
import * as XLSX from 'xlsx'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { getStats, getAdvisorStats, getSurveyRecords, updateSurveyRecord, replaceServiceRanker } from './api'
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

function normalizeName(value){
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'_')
    .replace(/^_+|_+$/g,'')
}

function findNumber(row, keys){
  for(const k of Object.keys(row)){
    const nk = normalizeName(k)
    if(keys.some(x => nk.includes(x))){
      const n = Number(String(row[k]).replace('%','').trim())
      if(!Number.isNaN(n)) return n
    }
  }
  return 0
}

function parseCsiWorkbook(workbook){
  const advisorRows = []
  let metrics = { store_nps: 0, region_score: 83.2, national_score: 86.42 }

  for(const sheetName of workbook.SheetNames){
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

    for(const row of rows){
      const keys = Object.keys(row)
      const values = Object.values(row).map(v => String(v ?? '').trim())
      const combined = values.join(' ').toLowerCase()

      // Try to capture overall metrics if present anywhere in the file.
      if(combined.includes('national') && !metrics.national_score){
        const nums = values.map(v => Number(String(v).replace('%',''))).filter(n => !Number.isNaN(n))
        if(nums.length) metrics.national_score = nums[0]
      }
      if((combined.includes('region') || combined.includes('ce region')) && !metrics.region_score){
        const nums = values.map(v => Number(String(v).replace('%',''))).filter(n => !Number.isNaN(n))
        if(nums.length) metrics.region_score = nums[0]
      }
      if((combined.includes('store') || combined.includes('dealer')) && !metrics.store_nps){
        const nums = values.map(v => Number(String(v).replace('%',''))).filter(n => !Number.isNaN(n))
        if(nums.length) metrics.store_nps = nums[0]
      }

      const advisorKey = keys.find(k => normalizeName(k).includes('advisor') || normalizeName(k).includes('employee') || normalizeName(k).includes('consultant') || normalizeName(k).includes('name'))
      let advisor = advisorKey ? String(row[advisorKey] || '').trim() : ''

      // Fallback: first all-caps looking name in row
      if(!advisor){
        advisor = values.find(v => /^[A-Z]+\\s+[A-Z]+/.test(v)) || ''
      }

      if(!advisor) continue
      if(advisor.toLowerCase().includes('national') || advisor.toLowerCase().includes('region') || advisor.toLowerCase().includes('total')) continue

      const nps = findNumber(row, ['final_nps','nps'])
      const completed = findNumber(row, ['completed_surveys','completed_survey','completed','surveys'])
      const impact = findNumber(row, ['impact'])

      if(nps === 0 && completed === 0) continue

      // Kia rank file does not always include promoters/passives/detractors.
      // Use completed/impact fallback so the leaderboard still updates.
      const promoters = Math.max(0, Math.round((completed + impact) / 2))
      const detractors = Math.max(0, completed - promoters)
      const passives = Math.max(0, completed - promoters - detractors)

      advisorRows.push({
        advisor: advisor.toLowerCase().replace(/\\b\\w/g, c => c.toUpperCase()),
        nps,
        completed_surveys: completed,
        promoters,
        passives,
        detractors,
        impact,
      })
    }
  }

  // Better metric fallback from advisor rows if file did not expose store metric.
  if(!metrics.store_nps && advisorRows.length){
    const totalCompleted = advisorRows.reduce((s,r)=>s + Number(r.completed_surveys || 0), 0)
    const weighted = advisorRows.reduce((s,r)=>s + Number(r.nps || 0) * Number(r.completed_surveys || 0), 0)
    metrics.store_nps = totalCompleted ? Number((weighted / totalCompleted).toFixed(2)) : 0
  }

  return { advisorRows, metrics }
}

function KpiCards({stats, activeFilter, onFilterChange}){
  if(!stats) return <div className="grid">{Array.from({length:8}).map((_,i)=><div key={i} className="card"><div className="label">Loading</div></div>)}</div>
  const cards = [
    {key:'nps', label:'Store NPS', value:fmt(stats.nps_score), cls:npsClass(stats.nps_score), desc:`Region ${REGION_NPS}`},
    {key:'region', label:'Region', value:stats.region_score, cls:'blue', desc:'Benchmark'},
    {key:'national', label:'National Score', value:stats.national_score, cls:'purple', desc:'National benchmark'},
    {key:'Disposition Only', label:'Disposition Only', value:stats.disposition_only, cls:'cyan', desc:'Surveyed, no follow-up', filter:true},
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
    <table><thead><tr><th>Rank</th><th>Advisor</th><th>Final CSI / NPS</th><th>Completed</th><th>Promoters</th><th>Passives</th><th>Detractors</th><th>Impact</th></tr></thead>
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
    <div className="footer"><span>NPS source: service_ranker</span><span>Impact = Promoters − Detractors</span></div>
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
  const filtered = useMemo(()=>{
    const q=search.toLowerCase()
    return records.filter(r=>Object.values(r).join(' ').toLowerCase().includes(q))
  },[records,search])
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
    <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Advisor</th><th>Status</th><th>Survey Code</th><th>RO Number</th><th>Date Contacted</th><th>Contact Method</th><th>Customer Response</th><th>Follow Up</th><th>Manager Notes</th><th></th></tr></thead>
    <tbody>{loading?<tr><td colSpan="11">Loading...</td></tr>:pageRows.map(r=>{
      const editing=edit?.id===r.id
      const status=val(r,'follow_up_category') || r.status
      return <tr key={r.id}>
        <td><b>{r.customer_name}</b></td><td>{r.advisor}</td>
        <td>{editing?<select value={status||''} onChange={e=>set('follow_up_category',e.target.value)}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select>:<span className={`badge ${statusClass(status)}`}>{status}</span>}</td>
        <td>{r.survey_code||'—'}</td><td>{r.ro_number||'—'}</td>
        <td>{editing?<input type="date" value={val(r,'date_contacted')||''} onChange={e=>set('date_contacted',e.target.value)}/>:r.date_contacted||'—'}</td>
        <td>{editing?<select value={val(r,'contact_method')||''} onChange={e=>set('contact_method',e.target.value)}>{CONTACT_METHODS.map(s=><option key={s}>{s}</option>)}</select>:r.contact_method||'—'}</td>
        <td>{editing?<textarea value={val(r,'customer_response')||''} onChange={e=>set('customer_response',e.target.value)}/>:r.customer_response||'—'}</td>
        <td>{editing?<input type="checkbox" checked={!!val(r,'follow_up_needed')} onChange={e=>set('follow_up_needed',e.target.checked)}/>:r.follow_up_needed?'Yes':'No'}</td>
        <td>{editing?<textarea value={val(r,'manager_notes')||''} onChange={e=>set('manager_notes',e.target.value)}/>:r.manager_notes||'—'}</td>
        <td>{editing?<div className="row-actions"><button className="btn" onClick={save}><Save size={14}/> Save</button><button className="btn" onClick={()=>setEdit(null)}><X size={14}/></button></div>:<button className="btn" onClick={()=>setEdit({...r})}><Edit2 size={14}/> Edit</button>}</td>
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
  const fileRef = useRef(null)

  async function refresh(currentFilter=filter){
    try{
      setErr('')
      setLoading(true)
      const [s,a,r] = await Promise.all([getStats(), getAdvisorStats(), getSurveyRecords(currentFilter)])
      setStats(s)
      setAdvisors(a)
      setRecords(r.rows)
      setTotal(s.followup_total)
    }catch(e){
      console.error(e)
      setErr(e.message || String(e))
    }finally{
      setLoading(false)
    }
  }

  useEffect(()=>{refresh('All')},[])

  async function changeFilter(f){
    setFilter(f)
    await refresh(f)
  }

  async function handleCsiUpload(e){
    const file = e.target.files?.[0]
    if(!file) return
    try{
      setImportStatus('Reading CSI report...')
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const { advisorRows, metrics } = parseCsiWorkbook(workbook)

      if(!advisorRows.length){
        throw new Error('No advisor rows found in this CSI report. Please make sure this is the Kia Service Ranker Excel export.')
      }

      setImportStatus(`Importing ${advisorRows.length} advisor rows...`)
      await replaceServiceRanker(advisorRows, metrics)
      setImportStatus(`Imported ${advisorRows.length} CSI advisor rows successfully.`)
      await refresh(filter)
    }catch(error){
      console.error(error)
      setImportStatus(`Import failed: ${error.message || error}`)
    }finally{
      if(fileRef.current) fileRef.current.value = ''
    }
  }

  return <div>
    <header className="header">
      <div className="brand"><div className="logo">KIA</div><div><b>NAPLETON KIA MID RIVERS</b><div className="small">Service Performance Dashboard</div></div></div>
      <div className="admin-import">
        <input ref={fileRef} className="hidden-file" type="file" accept=".xlsx,.xls,.csv" onChange={handleCsiUpload} />
        <button className="btn import-btn" onClick={()=>fileRef.current?.click()}><Upload size={14}/> Upload CSI Report</button>
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
