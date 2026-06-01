import { supabase } from './supabase'

export async function getStats() {
  const { data: followups, error: fErr } = await supabase.from('survey_followups').select('follow_up_category')
  if (fErr) throw fErr

  const counts = {
    complete: 0,
    committed: 0,
    unresponsive: 0,
    issues: 0,
    disposition_only: 0,
    followup_total: followups?.length ?? 0,
  }

  ;(followups ?? []).forEach((r) => {
    const c = (r.follow_up_category || '').trim()
    if (c === 'Complete') counts.complete++
    if (c === 'Committed') counts.committed++
    if (c === 'Unresponsive') counts.unresponsive++
    if (c === 'Issue') counts.issues++
    if (c === 'Disposition Only') counts.disposition_only++
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
        impact: Number(r.impact ?? (Number(r.promoters ?? 0) - Number(r.detractors ?? 0))),
        committed: countsByAdvisor[key]?.committed ?? 0,
        unresponsive: countsByAdvisor[key]?.unresponsive ?? 0,
        issues: countsByAdvisor[key]?.issues ?? 0,
      }
    })
    .sort((a, b) => b.nps_score - a.nps_score)
}

export async function getSurveyRecords(status = 'All') {
  let q = supabase.from('survey_followups').select('*').order('updated_at', { ascending: false })
  if (status && status !== 'All') q = q.eq('follow_up_category', status)
  const { data, error } = await q
  if (error) throw error
  return { rows: data ?? [], total: data?.length ?? 0 }
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
