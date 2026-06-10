import { supabase } from './supabase'

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
  const cleanRows = rows
    .filter((r) => r.advisor && String(r.advisor).trim() !== '')
    .map((r) => ({
      advisor: canonicalAdvisor(r.advisor),
      sample_size: Number(r.sample_size || 0),
      final_nps: Number(r.final_nps || 0),
      issue_rate: Number(r.issue_rate || 0),
      no_issue_rate: Number(r.no_issue_rate || 0),
      optional_sample_size: r.optional_sample_size === null || r.optional_sample_size === undefined || r.optional_sample_size === '' ? null : Number(r.optional_sample_size),
      initiation_rating: r.initiation_rating === null || r.initiation_rating === undefined || r.initiation_rating === '' ? null : Number(r.initiation_rating),
      consultant_rating: r.consultant_rating === null || r.consultant_rating === undefined || r.consultant_rating === '' ? null : Number(r.consultant_rating),
      facility_rating: r.facility_rating === null || r.facility_rating === undefined || r.facility_rating === '' ? null : Number(r.facility_rating),
      quality_rating: r.quality_rating === null || r.quality_rating === undefined || r.quality_rating === '' ? null : Number(r.quality_rating),
      pickup_rating: r.pickup_rating === null || r.pickup_rating === undefined || r.pickup_rating === '' ? null : Number(r.pickup_rating),
      imported_at: new Date().toISOString(),
    }))

  const { error: deleteError } = await supabase
    .from('advisor_metrics_performance')
    .delete()
    .neq('advisor', '__never_match__')

  if (deleteError) throw deleteError

  if (cleanRows.length > 0) {
    const { error: insertError } = await supabase.from('advisor_metrics_performance').insert(cleanRows)
    if (insertError) throw insertError
  }

  return { imported: cleanRows.length }
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
  const cleanRows = rows
    .filter((r) => r.ro_number || r.customer_name || r.survey_id)
    .map((r) => ({
      survey_id: r.survey_id || null,
      customer_name: r.customer_name || null,
      ro_number: r.ro_number || null,
      advisor: canonicalAdvisor(r.advisor) || null,
      response_date: r.response_date || null,
      survey_status: r.survey_status || null,
      ksi: r.ksi == null ? null : Number(r.ksi),
      likelihood_to_recommend: r.likelihood_to_recommend == null ? null : Number(r.likelihood_to_recommend),
      vin: r.vin || null,
      email: r.email || null,
    }))

  const { error: deleteError } = await supabase
    .from('survey_results')
    .delete()
    .neq('id', 0)

  if (deleteError) throw deleteError

  if (cleanRows.length > 0) {
    const { error: insertError } = await supabase.from('survey_results').insert(cleanRows)
    if (insertError) throw insertError
  }

  return { imported: cleanRows.length }
}


export async function replaceRepairOrders(rows) {
  const cleanRows = rows
    .filter((r) => r.ro || r.customer)
    .map((r) => ({
      ro: r.ro || null,
      tag: r.tag || null,
      customer: r.customer || null,
      model: r.model || null,
      year: r.year == null ? null : Number(r.year),
      promise_date: r.promise_date || null,
      status: r.status || null,
      advisor: r.advisor || null,
      tech: r.tech || null,
      notes: r.notes || null,
    }))

  const { error: deleteError } = await supabase
    .from('repair_orders')
    .delete()
    .neq('id', 0)

  if (deleteError) throw deleteError

  if (cleanRows.length > 0) {
    const { error: insertError } = await supabase.from('repair_orders').insert(cleanRows)
    if (insertError) throw insertError
  }

  return { imported: cleanRows.length }
}

export async function replacePreInvoices(rows) {
  const cleanRows = rows
    .filter((r) => r.ro || r.customer)
    .map((r) => ({
      ro: r.ro || null,
      customer: r.customer || null,
      age: r.age == null ? null : Number(r.age),
      model: r.model || null,
      year: r.year == null ? null : Number(r.year),
      status_desc: r.status_desc || null,
      advisor: r.advisor || null,
      tech: r.tech || null,
      invoice_amount: r.invoice_amount == null ? null : Number(r.invoice_amount),
      ro_estimate: r.ro_estimate == null ? null : Number(r.ro_estimate),
      notes: r.notes || null,
    }))

  const { error: deleteError } = await supabase
    .from('pre_invoices')
    .delete()
    .neq('id', 0)

  if (deleteError) throw deleteError

  if (cleanRows.length > 0) {
    const { error: insertError } = await supabase.from('pre_invoices').insert(cleanRows)
    if (insertError) throw insertError
  }

  return { imported: cleanRows.length }
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
  const cleanRows = rows
    .filter((r) => r.customer || r.ro || r.stock)
    .map((r) => ({
      customer: r.customer || null,
      advisor: r.advisor || null,
      ro: r.ro || null,
      date_out: r.date_out || null,
      days_in_rental: r.days_in_rental == null ? null : Number(r.days_in_rental),
      days_in_service: r.days_in_service == null ? null : Number(r.days_in_service),
      warr: r.warr || null,
      ex_warr: r.ex_warr || null,
      pay: r.pay || null,
      stock: r.stock || null,
      notes: r.notes || null,
    }))

  const { error: deleteError } = await supabase
    .from('rentals_out')
    .delete()
    .neq('id', 0)

  if (deleteError) throw deleteError

  if (cleanRows.length > 0) {
    const { error: insertError } = await supabase.from('rentals_out').insert(cleanRows)
    if (insertError) throw insertError
  }

  return { imported: cleanRows.length }
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
  const cleanRows = rows
    .filter((r) => r.control || r.description || r.adjustment_amount)
    .map((r) => ({
      debit_account: r.debit_account || null,
      debit_amount: r.debit_amount == null ? null : Number(r.debit_amount),
      control: r.control || null,
      description: r.description || null,
      credit_account: r.credit_account || null,
      credit_amount: r.credit_amount == null ? null : Number(r.credit_amount),
      advisor: r.advisor || null,
      advisor_id: r.advisor_id || null,
      tech: r.tech || null,
      tech_id: r.tech_id || null,
      tech_time: r.tech_time == null ? null : Number(r.tech_time),
      adjustment_amount: r.adjustment_amount == null ? null : Number(r.adjustment_amount),
      notes: r.notes || null,
      category: r.category || null,
    }))

  const { error: deleteError } = await supabase
    .from('warranty_adjustments')
    .delete()
    .neq('id', 0)

  if (deleteError) throw deleteError

  if (cleanRows.length > 0) {
    const { error: insertError } = await supabase.from('warranty_adjustments').insert(cleanRows)
    if (insertError) throw insertError
  }

  return { imported: cleanRows.length }
}

export async function getWarrantyAdjustments() {
  const { data, error } = await supabase
    .from('warranty_adjustments')
    .select('*')
    .order('adjustment_amount', { ascending: true })

  if (error) throw error
  return data ?? []
}
