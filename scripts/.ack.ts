import { db } from '@/lib/data'
import { composeDraft } from '@/workers/f7-drafts'
import { loadTemplate } from '@/lib/templates'
const ID = 'recBHwsFsX6OT27Vh'
async function main() {
  const p = db()
  const t = await loadTemplate('ack.inquiry')
  console.log('resolve ack.inquiry →', t ? `${t.key} "${t.subject.slice(0, 50)}"` : 'STILL NOT FOUND')
  if (!t) return
  const deal = await p.getDeal(ID)
  if (!deal) return console.log('deal missing')
  const draft = await composeDraft({ deal, type: 'ack', templateKey: 'ack.inquiry' })
  console.log('composed →', `${draft.type}/${draft.status} to=${draft.toEmail} subj="${draft.subject.slice(0, 60)}"`)
  for (const d of await p.listDrafts({ dealId: ID })) console.log('  draft', d.type, d.status, d.sentAt ?? '(not sent)', d.toEmail)
}
main().catch((e) => console.error('FAILED:', String(e).slice(0, 400)))
