import { supabase } from './supabase'

function normRo(value) {
  return String(value ?? '').trim().toUpperCase()
}

function normName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
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

export async function getStats() {
  const { data: followups, error: fErr } = await supabase.from('survey_followups').select('*')
  if (fErr) throw fErr

  const { data: dispositions, error: dErr } = await supabase.from('disposition_imports').select('*')
  if (dErr) throw dErr

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
  ;(dispositions ?? []).forEach((d) => {
    const hasFollowup = (followups ?? []).some((f) => findDispositionMatch(f, { byRo: new Map([[getRoKey(d), d]].filter(([k]) => k)), byName: new Map([[getNameKey(d), d]].filter(([k]) => k)) }))
    if (hasFollowup) counts.matched_total++
    else counts.missing_followups++
  })

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
  }
}

export async function getAdvisorStats() {
  const { data: sr, error } = await supabase.from('service_ranker').select('*')
  if (error) throw error

  const { data: sf, error: sfErr } = await supabase.from('survey_followups').select('advisor,follow_up_category')
  if (sfErr) throw sfErr

  const countsByAdvisor = {}

  ;(sf ?? []).forEach((r) => {
    const a = (r.advisor || '').trim().toLowerCase()
    if (!a) return
    countsByAdvisor[a] ??= { committed: 0, unresponsive: 0, issues: 0 }
    if (r.follow_up_category === 'Committed') countsByAdvisor[a].committed++
    if (r.follow_up_category === 'Unresponsive') countsByAdvisor[a].unresponsive++
    if (r.follow_up_category === 'Issue') countsByAdvisor[a].issues++
  })

  return (sr ?? [])
    .filter((r) => r.advisor && r.advisor !== '-' && r.advisor !== 'Agnes Kramek')
    .map((r) => {
      const key = String(r.advisor).trim().toLowerCase()
      return {
        advisor: r.advisor,
        nps_score: Number(r.nps ?? 0),
        completed_surveys: Number(r.completed_surveys ?? 0),
        promoters: Number(r.promoters ?? 0),
        passives: Number(r.passives ?? 0),
        detractors: Number(r.detractors ?? 0),
        total_scored: Number(r.completed_surveys ?? 0),
        impact: Number(r.impact ?? 0),
        committed: countsByAdvisor[key]?.committed ?? 0,
        unresponsive: countsByAdvisor[key]?.unresponsive ?? 0,
        issues: countsByAdvisor[key]?.issues ?? 0,
      }
    })
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

  const dispositionMaps = buildDispositionMaps(dispositions ?? [])

  const usedDispositionKeys = new Set()

  const enrichedFollowups = (followups ?? []).map((r) => {
    const match = findDispositionMatch(r, dispositionMaps)
    if (match) usedDispositionKeys.add(getMatchKeyForUsed(r, match))

    const category = r.follow_up_category || r.status || ''
    const committed = category === 'Committed'
    const complete = category === 'Complete'
    const unresponsive = category === 'Unresponsive'
    const issue = category === 'Issue'

    return {
      ...r,
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

export async function replaceServiceRanker(rows, metrics) {
  const cleanRows = rows
    .filter((r) => r.advisor && String(r.advisor).trim() !== '')
    .map((r) => ({
      advisor: String(r.advisor).trim(),
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
      advisor: r.advisor || null,
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
      advisor: r.advisor || null,
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
