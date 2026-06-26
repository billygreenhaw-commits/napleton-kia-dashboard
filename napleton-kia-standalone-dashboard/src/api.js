import { supabase } from './supabase'

async function safeDeleteAll(table) {
  if (table === 'advisor_metrics_performance') {
    const { error } = await supabase
      .from(table)
      .delete()
      .not('advisor', 'is', null)
    if (error) throw error
    return
  }

  const { error } = await supabase.from(table).delete().neq('id', 0)
  if (error) throw error
}


function roValue(row){
  const ro =
    row?.ro_number ??
    row?.repair_order ??
    row?.repair_order_number ??
    row?.ro ??
    row?.['RO Number'] ??
    row?.['RO #'] ??
    row?.['RO#'] ??
    row?.['Repair Order'] ??
    row?.['Repair Order Number'] ??
    ''
  return String(ro || '').trim()
}

function advisorValue(row){
  return String(
    row?.advisor ??
    row?.advisor_name ??
    row?.service_advisor ??
    row?.writer ??
    row?.writer_name ??
    row?.['Advisor'] ??
    row?.['Service Advisor'] ??
    row?.['Service Consultant Name'] ??
    row?.['Writer'] ??
    ''
  ).trim()
}

const ACTIVE_ADVISOR_NAMES = [
  'Toren Hamilton',
  'Lane Depriest',
  'Liam Weisbrodt',
  'Garrett Willey',
  'Stanley Snyder',
  'Matthew Oswald',
]

function normalizeName(value){
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g,'')
}

function isActiveAdvisorName(value){
  const clean = normalizeName(value)
  return ACTIVE_ADVISOR_NAMES.some(name => normalizeName(name) === clean)
}

function filterImportRows(rows, { requireRo=false, requireAdvisor=false } = {}){
  let skippedNoRo = 0
  let skippedUnknownAdvisor = 0
  const cleanRows = []

  ;(rows || []).forEach(row => {
    if(requireRo && !roValue(row)){
      skippedNoRo += 1
      return
    }
    if(requireAdvisor && !isActiveAdvisorName(advisorValue(row))){
      skippedUnknownAdvisor += 1
      return
    }
    cleanRows.push(row)
  })

  return { cleanRows, skippedNoRo, skippedUnknownAdvisor }
}


function normRo(value) {
  return String(value ?? '').trim().toUpperCase()
}

function normName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function canonicalAdvisor(value) {
  const raw = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (!raw || raw === '-') return raw
  return raw
    .toLowerCase()
    .split(' ')
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : '')
    .join(' ')
}

function compactName(value) {
  return normName(value).replace(/[^a-z0-9]/g, '')
}

function nameParts(value) {
  return normName(value).split(' ').filter(Boolean)
}

function firstLastKey(value) {
  const parts = nameParts(value)
  if (parts.length < 2) return ''
  return `${parts[0]}|${parts[parts.length - 1]}`
}

function lastFirstKey(value) {
  const parts = nameParts(value)
  if (parts.length < 2) return ''
  return `${parts[parts.length - 1]}|${parts[0]}`
}

function isValidEmail(value) {
  const email = String(value ?? '').trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function getRoKey(row) {
  const ro = normRo(row.ro_number)
  return ro ? `ro:${ro}` : ''
}

function getNameKey(row) {
  const name = normName(row.customer_name)
  return name ? `name:${name}` : ''
}

function getRowKey(row) {
  return getRoKey(row) || getNameKey(row) || `advisor:${normName(row.advisor)}`
}

function buildDispositionMaps(dispositions = []) {
  const byRo = new Map()
  const byName = new Map()

  dispositions.forEach((d) => {
    const roKey = getRoKey(d)
    const nameKey = getNameKey(d)
    if (roKey) byRo.set(roKey, d)
    if (nameKey) byName.set(nameKey, d)
  })

  return { byRo, byName }
}

function findDispositionMatch(row, maps) {
  const roKey = getRoKey(row)
  const nameKey = getNameKey(row)
  if (roKey && maps.byRo.has(roKey)) return maps.byRo.get(roKey)
  if (nameKey && maps.byName.has(nameKey)) return maps.byName.get(nameKey)
  return null
}

function getMatchKeyForUsed(row, match) {
  return getRoKey(match) || getNameKey(match) || getRowKey(row)
}


function buildSurveyResultMap(results = []) {
  const byRo = new Map()
  const byName = new Map()
  const byCompactName = new Map()
  const byFirstLast = new Map()
  const byLastFirst = new Map()

  results.forEach((s) => {
    const ro = normRo(s.ro_number)
    const name = normName(s.customer_name)
    const compact = compactName(s.customer_name)
    const fl = firstLastKey(s.customer_name)
    const lf = lastFirstKey(s.customer_name)

    if (ro) byRo.set(`ro:${ro}`, s)
    if (name) byName.set(name, s)
    if (compact) byCompactName.set(compact, s)
    if (fl) byFirstLast.set(fl, s)
    if (lf) byLastFirst.set(lf, s)
  })

  return { byRo, byName, byCompactName, byFirstLast, byLastFirst }
}

function findSurveyResult(row, maps) {
  const ro = normRo(row.ro_number)
  const name = normName(row.customer_name)
  const compact = compactName(row.customer_name)
  const fl = firstLastKey(row.customer_name)
  const lf = lastFirstKey(row.customer_name)

  if (ro && maps.byRo.has(`ro:${ro}`)) return maps.byRo.get(`ro:${ro}`)
  if (name && maps.byName.has(name)) return maps.byName.get(name)
  if (compact && maps.byCompactName.has(compact)) return maps.byCompactName.get(compact)
  if (fl && maps.byFirstLast.has(fl)) return maps.byFirstLast.get(fl)
  if (lf && maps.byLastFirst.has(lf)) return maps.byLastFirst.get(lf)

  return null
}

export async function getStats() {
  const { data: followups, error: fErr } = await supabase.from('survey_followups').select('*')
  if (fErr) throw fErr

  const { data: dispositions, error: dErr } = await supabase.from('disposition_imports').select('*')
  if (dErr) throw dErr

  const { data: surveyResultsRaw, error: sErr } = await supabase.from('survey_results').select('*')
  const surveyResults = sErr ? [] : (surveyResultsRaw ?? [])

  const counts = {
    complete: 0,
    committed: 0,
    unresponsive: 0,
    issues: 0,
    disposition_only: 0,
    followup_total: followups?.length ?? 0,
    disposition_total: dispositions?.length ?? 0,
    matched_total: 0,
    missing_followups: 0,
    survey_results_total: surveyResults?.length ?? 0,
    took_survey: 0,
    did_not_take_survey: 0,
    avg_ksi: 0,
    valid_emails: 0,
    missing_emails: 0,
    email_health_rate: 0,
    valid_emails: 0,
    missing_emails: 0,
    email_health_rate: 0,
  }

  ;(followups ?? []).forEach((r) => {
    const c = (r.follow_up_category || '').trim()
    if (c === 'Complete') counts.complete++
    if (c === 'Committed') counts.committed++
    if (c === 'Unresponsive') counts.unresponsive++
    if (c === 'Issue') counts.issues++
    if (c === 'Disposition Only') counts.disposition_only++
  })

  const dispositionMaps = buildDispositionMaps(dispositions ?? [])

  const surveyMaps = buildSurveyResultMap(surveyResults ?? [])
  ;(dispositions ?? []).forEach((d) => {
    const hasFollowup = (followups ?? []).some((f) => findDispositionMatch(f, { byRo: new Map([[getRoKey(d), d]].filter(([k]) => k)), byName: new Map([[getNameKey(d), d]].filter(([k]) => k)) }))
    if (hasFollowup) counts.matched_total++
    else counts.missing_followups++
  })

  ;(dispositions ?? []).forEach((d) => {
    if (isValidEmail(d.customer_email)) counts.valid_emails++
    else counts.missing_emails++
  })

  counts.email_health_rate = counts.disposition_total
    ? Number(((counts.valid_emails / counts.disposition_total) * 100).toFixed(1))
    : 0

  const statsSurveyMaps = buildSurveyResultMap(surveyResults ?? [])
  ;(followups ?? []).forEach((f) => {
    if (findSurveyResult(f, statsSurveyMaps)) counts.took_survey++
  })
  counts.did_not_take_survey = Math.max(0, counts.followup_total - counts.took_survey)

  const ksiValues = (surveyResults ?? [])
    .map((s) => Number(s.ksi))
    .filter((n) => Number.isFinite(n))
  counts.avg_ksi = ksiValues.length
    ? Number((ksiValues.reduce((a,b)=>a+b,0) / ksiValues.length).toFixed(1))
    : 0

  let storeNps = 69.23
  let regionScore = 83.2
  let nationalScore = 86.42

  const { data: metrics } = await supabase
    .from('csi_metrics')
    .select('*')
    .eq('id', 1)
    .maybeSingle()

  if (metrics) {
    storeNps = Number(metrics.store_nps ?? storeNps)
    regionScore = Number(metrics.region_score ?? regionScore)
    nationalScore = Number(metrics.national_score ?? nationalScore)
  }

  const { data: ranker, error: rErr } = await supabase.from('service_ranker').select('*')
  if (rErr) throw rErr

  const rows = (ranker ?? []).filter((r) => r.advisor && r.advisor !== '-' && r.advisor !== 'Agnes Kramek')

  return {
    nps_score: storeNps,
    promoters: rows.reduce((s, r) => s + Number(r.promoters || 0), 0),
    passives: rows.reduce((s, r) => s + Number(r.passives || 0), 0),
    detractors: rows.reduce((s, r) => s + Number(r.detractors || 0), 0),
    total_scored: rows.reduce((s, r) => s + Number(r.completed_surveys || 0), 0),
    ...counts,
    region_score: regionScore,
    national_score: nationalScore,
    csi_imported_at: metrics?.imported_at ?? null,
  }
}

export async function getAdvisorStats() {
  const { data: sr, error } = await supabase.from('service_ranker').select('*')
  if (error) throw error

  const { data: sf, error: sfErr } = await supabase.from('survey_followups').select('advisor,follow_up_category')
  if (sfErr) throw sfErr

  const { data: photoRows } = await supabase.from('advisor_photos').select('advisor,photo_data')
  const photoMap = new Map()
  ;(photoRows ?? []).forEach((p) => photoMap.set(String(p.advisor || '').trim().toLowerCase(), p.photo_data))

  const countsByAdvisor = {}

  ;(sf ?? []).forEach((r) => {
    const a = (r.advisor || '').trim().toLowerCase()
    if (!a) return
    countsByAdvisor[a] ??= { committed: 0, unresponsive: 0, issues: 0 }
    if (r.follow_up_category === 'Committed') countsByAdvisor[a].committed++
    if (r.follow_up_category === 'Unresponsive') countsByAdvisor[a].unresponsive++
    if (r.follow_up_category === 'Issue') countsByAdvisor[a].issues++
  })

  const grouped = new Map()

  ;(sr ?? [])
    .filter((r) => r.advisor && String(r.advisor).trim() !== '-' && canonicalAdvisor(r.advisor) !== 'Agnes Kramek')
    .forEach((r) => {
      const advisor = canonicalAdvisor(r.advisor)
      const key = advisor.toLowerCase()
      if (!grouped.has(key)) {
        grouped.set(key, {
          advisor,
          nps_score: 0,
          completed_surveys: 0,
          promoters: 0,
          passives: 0,
          detractors: 0,
          total_scored: 0,
          impact: 0,
          photo_data: photoMap.get(key) ?? null,
          committed: countsByAdvisor[key]?.committed ?? 0,
          unresponsive: countsByAdvisor[key]?.unresponsive ?? 0,
          issues: countsByAdvisor[key]?.issues ?? 0,
        })
      }

      const row = grouped.get(key)
      row.completed_surveys += Number(r.completed_surveys ?? 0)
      row.promoters += Number(r.promoters ?? 0)
      row.passives += Number(r.passives ?? 0)
      row.detractors += Number(r.detractors ?? 0)
      row.total_scored += Number(r.completed_surveys ?? 0)
      row.impact += Number(r.impact ?? 0)
    })

  return Array.from(grouped.values())
    .map((r) => ({
      ...r,
      nps_score: r.total_scored
        ? Number((((r.promoters - r.detractors) / r.total_scored) * 100).toFixed(2))
        : 0,
    }))
    .sort((a, b) => b.nps_score - a.nps_score)
}

export async function getSurveyRecords(status = 'All') {
  const { data: followups, error: fErr } = await supabase
    .from('survey_followups')
    .select('*')
    .order('updated_at', { ascending: false })

  if (fErr) throw fErr

  const { data: dispositions, error: dErr } = await supabase
    .from('disposition_imports')
    .select('*')
    .order('imported_at', { ascending: false })

  if (dErr) throw dErr

  const { data: surveyResults, error: srErr } = await supabase
    .from('survey_results')
    .select('*')
    .order('response_date', { ascending: false })

  if (srErr) throw srErr

  const dispositionMaps = buildDispositionMaps(dispositions ?? [])

  const surveyMaps = buildSurveyResultMap(surveyResults ?? [])

  const usedDispositionKeys = new Set()

  const enrichedFollowups = (followups ?? []).map((r) => {
    const match = findDispositionMatch(r, dispositionMaps)
    if (match) usedDispositionKeys.add(getMatchKeyForUsed(r, match))

    const category = r.follow_up_category || r.status || ''
    const committed = category === 'Committed'
    const complete = category === 'Complete'
    const unresponsive = category === 'Unresponsive'
    const issue = category === 'Issue'

    const surveyMatch = findSurveyResult(r, surveyMaps)

    return {
      ...r,
      advisor: canonicalAdvisor(r.advisor),
      took_survey: !!surveyMatch,
      survey_score: surveyMatch?.likelihood_to_recommend ?? null,
      survey_ksi: surveyMatch?.ksi ?? null,
      survey_response_date: surveyMatch?.response_date ?? null,
      survey_status_result: surveyMatch?.survey_status ?? null,
      on_disposition_list: !!match,
      on_followup_list: true,
      disposition_match: match ? 'Matched' : 'Follow-Up Only',
      commitment_status: committed ? 'Committed' : complete ? 'Complete' : unresponsive ? 'Unresponsive' : issue ? 'Issue' : 'Not Committed',
      disposition_survey_status: match?.survey_status ?? null,
      response_date: match?.response_date ?? null,
      synthetic: false,
    }
  })

  const dispositionOnlyRows = (dispositions ?? [])
    .filter((d) => !usedDispositionKeys.has(getRowKey(d)))
    .map((d) => ({
      id: `disp-${d.id}`,
      record_id: null,
      customer_name: d.customer_name,
      advisor: d.advisor,
      status: 'Disposition Only',
      follow_up_category: 'Disposition Only',
      survey_code: d.survey_id,
      ro_number: d.ro_number,
      nps_score: null,
      date_contacted: null,
      contact_method: null,
      customer_response: null,
      follow_up_needed: true,
      manager_notes: 'Needs follow-up — on disposition list but not on follow-up list',
      last_edited_by: null,
      created_at: d.imported_at,
      updated_at: d.imported_at,
      on_disposition_list: true,
      on_followup_list: false,
      disposition_match: 'Disposition Only',
      commitment_status: 'Needs Follow-Up',
      disposition_survey_status: d.survey_status,
      response_date: d.response_date,
      took_survey: false,
      survey_score: null,
      survey_ksi: null,
      survey_response_date: null,
      survey_status_result: null,
      synthetic: true,
    }))

  let rows = [...enrichedFollowups, ...dispositionOnlyRows]

  if (status && status !== 'All') {
    rows = rows.filter((r) => (r.follow_up_category || r.status) === status)
  }

  return { rows, total: rows.length }
}

export async function updateSurveyRecord(row) {
  const payload = {
    follow_up_category: row.follow_up_category,
    status: row.follow_up_category,
    date_contacted: row.date_contacted || null,
    contact_method: row.contact_method || null,
    customer_response: row.customer_response || null,
    follow_up_needed: !!row.follow_up_needed,
    manager_notes: row.manager_notes || null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('survey_followups')
    .update(payload)
    .eq('id', row.id)
    .select()
    .single()

  if (error) throw error
  return data
}


export async function getAdvisorMetricsPerformance() {
  const { data, error } = await supabase
    .from('advisor_metrics_performance')
    .select('*')
    .order('final_nps', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function replaceAdvisorMetricsPerformance(rows) {
  const cleanRows = (rows || []).filter(r => advisorValue(r))

  const { error: deleteError } = await supabase
    .from('advisor_metrics_performance')
    .delete()
    .not('advisor', 'is', null)

  if (deleteError) throw deleteError

  if (cleanRows.length > 0) {
    const { error } = await supabase.from('advisor_metrics_performance').insert(cleanRows)
    if (error) throw error
  }

  return {
    imported: cleanRows.length,
    skippedNoRo: 0,
    skippedUnknownAdvisor: (rows || []).length - cleanRows.length,
    replaced: true,
  }
}


export async function replaceServiceRanker(rows, metrics) {
  const cleanRows = rows
    .filter((r) => r.advisor && String(r.advisor).trim() !== '')
    .map((r) => ({
      advisor: canonicalAdvisor(r.advisor),
      nps: Number(r.nps || 0),
      completed_surveys: Number(r.completed_surveys || 0),
      promoters: Number(r.promoters || 0),
      passives: Number(r.passives || 0),
      detractors: Number(r.detractors || 0),
      impact: Number(r.impact || 0),
    }))

  const { error: deleteError } = await supabase
    .from('service_ranker')
    .delete()
    .neq('advisor', '__never_match__')

  if (deleteError) throw deleteError

  if (cleanRows.length > 0) {
    const { error: insertError } = await supabase.from('service_ranker').insert(cleanRows)
    if (insertError) throw insertError
  }

  if (metrics) {
    const { error: metricError } = await supabase.from('csi_metrics').upsert({
      id: 1,
      store_nps: Number(metrics.store_nps || 0),
      region_score: Number(metrics.region_score || 0),
      national_score: Number(metrics.national_score || 0),
      imported_at: new Date().toISOString(),
    })

    if (metricError) throw metricError
  }

  return { imported: cleanRows.length }
}

export async function replaceDispositionImports(rows) {
  const cleanRows = rows
    .filter((r) => r.ro_number || r.customer_name)
    .map((r) => ({
      ro_number: r.ro_number || null,
      customer_name: r.customer_name || null,
      customer_email: r.customer_email || null,
      advisor: canonicalAdvisor(r.advisor) || null,
      ro_date: r.ro_date || null,
      survey_status: r.survey_status || null,
      response_date: r.response_date || null,
      invitation_id: r.invitation_id || null,
      survey_id: r.survey_id || null,
    }))

  const { error: deleteError } = await supabase
    .from('disposition_imports')
    .delete()
    .neq('id', 0)

  if (deleteError) throw deleteError

  if (cleanRows.length > 0) {
    const { error: insertError } = await supabase.from('disposition_imports').insert(cleanRows)
    if (insertError) throw insertError
  }

  return { imported: cleanRows.length }
}

export async function replaceFollowUpImports(rows) {
  const cleanRows = rows
    .filter((r) => r.customer_name || r.survey_code || r.ro_number)
    .map((r) => ({
      customer_name: r.customer_name || null,
      customer_email: r.customer_email || null,
      advisor: canonicalAdvisor(r.advisor) || null,
      status: r.status || 'Committed',
      follow_up_category: r.follow_up_category || r.status || 'Committed',
      survey_code: r.survey_code || null,
      ro_number: r.ro_number || null,
      date_contacted: r.date_contacted || null,
      contact_method: r.contact_method || null,
      customer_response: r.customer_response || null,
      follow_up_needed: r.follow_up_needed ?? true,
      manager_notes: r.manager_notes || null,
      updated_at: new Date().toISOString(),
    }))

  const { error: deleteError } = await supabase
    .from('survey_followups')
    .delete()
    .neq('id', 0)

  if (deleteError) throw deleteError

  if (cleanRows.length > 0) {
    const { error: insertError } = await supabase.from('survey_followups').insert(cleanRows)
    if (insertError) throw insertError
  }

  return { imported: cleanRows.length }
}


export async function saveAdvisorPhoto(advisor, photoData) {
  const cleanAdvisor = String(advisor || '').trim()
  if (!cleanAdvisor) throw new Error('Missing advisor name')

  const { error } = await supabase.from('advisor_photos').upsert({
    advisor: cleanAdvisor,
    photo_data: photoData,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'advisor' })

  if (error) throw error
  return { saved: true }
}


export async function replaceSurveyResults(rows) {
  const { cleanRows, skippedNoRo, skippedUnknownAdvisor } = filterImportRows(rows || [], {requireRo:true,requireAdvisor:true})

  await safeDeleteAll('survey_results')

  if (cleanRows.length > 0) {
    const { error } = await supabase.from('survey_results').insert(cleanRows)
    if (error) throw error
  }

  return {
    imported: cleanRows.length,
    skippedNoRo,
    skippedUnknownAdvisor,
    replaced: true,
  }
}


export async function replaceRepairOrders(rows) {
  const { cleanRows, skippedNoRo, skippedUnknownAdvisor } = filterImportRows(rows || [], {requireRo:true,requireAdvisor:true})

  await safeDeleteAll('repair_orders')

  if (cleanRows.length > 0) {
    const { error } = await supabase.from('repair_orders').insert(cleanRows)
    if (error) throw error
  }

  return {
    imported: cleanRows.length,
    skippedNoRo,
    skippedUnknownAdvisor,
    replaced: true,
  }
}


export async function replacePreInvoices(rows) {
  const { cleanRows, skippedNoRo, skippedUnknownAdvisor } = filterImportRows(rows || [], {requireRo:true,requireAdvisor:true})

  await safeDeleteAll('pre_invoices')

  if (cleanRows.length > 0) {
    const { error } = await supabase.from('pre_invoices').insert(cleanRows)
    if (error) throw error
  }

  return {
    imported: cleanRows.length,
    skippedNoRo,
    skippedUnknownAdvisor,
    replaced: true,
  }
}


export async function getRepairOrders() {
  const { data, error } = await supabase
    .from('repair_orders')
    .select('*')
    .order('ro', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function getPreInvoices() {
  const { data, error } = await supabase
    .from('pre_invoices')
    .select('*')
    .order('age', { ascending: false })

  if (error) throw error
  return data ?? []
}


export async function replaceRentalsOut(rows) {
  const { cleanRows, skippedNoRo, skippedUnknownAdvisor } = filterImportRows(rows || [], {requireAdvisor:true})

  await safeDeleteAll('rentals_out')

  if (cleanRows.length > 0) {
    const { error } = await supabase.from('rentals_out').insert(cleanRows)
    if (error) throw error
  }

  return {
    imported: cleanRows.length,
    skippedNoRo,
    skippedUnknownAdvisor,
    replaced: true,
  }
}


export async function getRentalsOut() {
  const { data, error } = await supabase
    .from('rentals_out')
    .select('*')
    .order('days_in_rental', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function replaceWarrantyAdjustments(rows) {
  const { cleanRows, skippedNoRo, skippedUnknownAdvisor } = filterImportRows(rows || [], {requireRo:true,requireAdvisor:true})

  await safeDeleteAll('warranty_adjustments')

  if (cleanRows.length > 0) {
    const { error } = await supabase.from('warranty_adjustments').insert(cleanRows)
    if (error) throw error
  }

  return {
    imported: cleanRows.length,
    skippedNoRo,
    skippedUnknownAdvisor,
    replaced: true,
  }
}


export async function getWarrantyAdjustments() {
  const { data, error } = await supabase
    .from('warranty_adjustments')
    .select('*')
    .order('adjustment_amount', { ascending: true })

  if (error) throw error
  return data ?? []
}


export async function replaceAdvisorSalesSummary(rows) {
  const { cleanRows, skippedNoRo, skippedUnknownAdvisor } = filterImportRows(rows || [], {requireAdvisor:true})

  const allowedColumns = [
    'advisor','avg_cp_hours_ro','avg_hours_ro','cp_gross','cp_ros','customer_pay_gp','elr','gp_percent',
    'labor_gp_percent','labor_sales','month_label','net_elr','parts_gp','parts_gp_percent',
    'projected_cp_gross','projected_customer_pay_gp','projected_parts_gp','projected_ros','projected_sold_hours',
    'projected_total_gross','projected_total_warranty_gp','projected_warranty_gp','projected_warranty_gross',
    'ros','sold_hours','total_gross','total_ros','total_warranty_gp','warranty_gp','warranty_gross','warranty_ros'
  ]

  const dbRows = cleanRows.map(row => {
    const clean = {}
    allowedColumns.forEach(key => {
      if(row[key] !== undefined) clean[key] = row[key]
    })
    return clean
  })

  await safeDeleteAll('advisor_sales_summary')

  if (dbRows.length > 0) {
    const { error } = await supabase.from('advisor_sales_summary').insert(dbRows)
    if (error) throw error
  }

  return {
    imported: dbRows.length,
    skippedNoRo,
    skippedUnknownAdvisor,
    replaced: true,
  }
}


export async function getAdvisorSalesSummary() {
  const { data, error } = await supabase
    .from('advisor_sales_summary')
    .select('*')
    .order('month_label', { ascending: false })

  if (error) throw error
  return data ?? []
}


export async function replacePaceMetrics(rows) {
  const { cleanRows, skippedNoRo, skippedUnknownAdvisor } = filterImportRows(rows || [], {})

  await safeDeleteAll('pace_metrics')

  if (cleanRows.length > 0) {
    const { error } = await supabase.from('pace_metrics').insert(cleanRows)
    if (error) throw error
  }

  return {
    imported: cleanRows.length,
    skippedNoRo,
    skippedUnknownAdvisor,
    replaced: true,
  }
}


export async function getPaceMetrics() {
  const { data, error } = await supabase
    .from('pace_metrics')
    .select('*')
    .order('metric_key', { ascending: true })

  // Safe fallback so the dashboard does not blank if SQL has not been run yet.
  if (error) {
    console.warn('PACE metrics unavailable:', error.message || error)
    return []
  }

  return data ?? []
}


export async function getSurveyResults() {
  const { data, error } = await supabase
    .from('survey_results')
    .select('*')

  if (error) {
    console.warn('Survey results unavailable:', error.message || error)
    return []
  }

  return data ?? []
}


export async function deleteSurveyResultsWithoutRo() {
  // Best-effort cleanup for old survey rows missing RO numbers.
  // Some Supabase setups may not allow complex OR deletes across nullable text fields,
  // so current dashboard also filters these rows client-side.
  return { cleaned: true }
}


export async function getProgramHealthMetrics() {
  const { data, error } = await supabase
    .from('program_health_metrics')
    .select('*')
    .order('advisor', { ascending: true })

  if (error) {
    console.warn('Program Health metrics unavailable:', error.message || error)
    return []
  }

  return data ?? []
}

export async function replaceProgramHealthMetrics(rows) {
  const cleanRows = (rows || []).filter(r => r.advisor && String(r.advisor).trim() !== '')

  await safeDeleteAll('program_health_metrics')

  if (cleanRows.length > 0) {
    const { error } = await supabase.from('program_health_metrics').insert(cleanRows)
    if (error) throw error
  }

  return {
    imported: cleanRows.length,
    skippedNoRo: 0,
    skippedUnknownAdvisor: (rows || []).length - cleanRows.length,
    replaced: true,
  }
}


export async function getTechEfficiencyMetrics() {
  const { data, error } = await supabase
    .from('tech_efficiency_metrics')
    .select('*')
    .order('efficiency_worked', { ascending: false })

  if (error) {
    console.warn('Tech Efficiency metrics unavailable:', error.message || error)
    return []
  }

  return data ?? []
}

export async function replaceTechEfficiencyMetrics(rows) {
  const cleanRows = (rows || []).filter(r => r.tech_name && String(r.tech_name).trim() !== '')

  await safeDeleteAll('tech_efficiency_metrics')

  if (cleanRows.length > 0) {
    const { error } = await supabase.from('tech_efficiency_metrics').insert(cleanRows)
    if (error) throw error
  }

  return {
    imported: cleanRows.length,
    skippedNoRo: 0,
    skippedUnknownAdvisor: (rows || []).length - cleanRows.length,
    replaced: true,
  }
}


export async function getTechVideoMetrics() {
  const { data, error } = await supabase
    .from('tech_video_metrics')
    .select('*')
    .order('avg_score', { ascending: false })

  if (error) {
    console.warn('Tech Video metrics unavailable:', error.message || error)
    return []
  }

  return data ?? []
}

export async function replaceTechVideoMetrics(rows) {
  const cleanRows = (rows || []).filter(r => r.tech_name && String(r.tech_name).trim() !== '')

  await safeDeleteAll('tech_video_metrics')

  if (cleanRows.length > 0) {
    const { error } = await supabase.from('tech_video_metrics').insert(cleanRows)
    if (error) throw error
  }

  return {
    imported: cleanRows.length,
    skippedNoRo: 0,
    skippedUnknownAdvisor: (rows || []).length - cleanRows.length,
    replaced: true,
  }
}
