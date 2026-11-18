import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import Modal, { Confirm, Field } from './Modal'
import TagInput from './TagInput'
import { api, errMsg } from '../api'
import { toast } from '../toast'
import { useI18n } from '../i18n'
import type { Snippet, VaultData } from '../types'

export default function Snippets({ data, reload }: { data: VaultData; reload: () => void }) {
  const { t } = useI18n()
  const [edit, setEdit] = useState<Partial<Snippet> | null>(null)
  const [del, setDel] = useState<Snippet | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const allTags = useMemo(() => Array.from(new Set(data.snippets.flatMap((s) => s.tags ?? []))).sort(), [data.snippets])
  const visible = tagFilter ? data.snippets.filter((s) => s.tags?.includes(tagFilter)) : data.snippets
  return (
    <div className="view">
      <div className="page-head">
        <h1>{t('snip.title')}</h1>
        <span className="sub">{t('snip.subtitle')}</span>
        <span className="grow" />
        <button className="btn primary" onClick={() => setEdit({ name: '', command: '', tags: [] })}><Plus size={15} /> {t('snip.newSnippet')}</button>
      </div>
      {allTags.length > 0 && (
        <div className="chips">
          {allTags.map((tag) => (
            <button key={tag} className={`chip ${tagFilter === tag ? 'on' : ''}`}
              onClick={() => setTagFilter((cur) => (cur === tag ? null : tag))}>{tag}</button>
          ))}
        </div>
      )}
      {data.snippets.length === 0 && (
        <div className="empty"><h3>{t('snip.emptyTitle')}</h3><p>{t('snip.emptyBody')}</p></div>
      )}
      {data.snippets.length > 0 && (
        <div className="list">
          {visible.map((s) => (
            <div className="lrow" key={s.id}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div className="muted mono ellipsis" style={{ fontSize: 12 }}>{s.command.split('\n')[0]}</div>
                {s.tags?.length > 0 && <div style={{ marginTop: 3 }}>{s.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>}
              </div>
              <button className="icon-btn" onClick={() => setEdit(s)}><Pencil size={15} /></button>
              <button className="icon-btn" onClick={() => setDel(s)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? t('snip.editTitle') : t('snip.newTitle')} onClose={() => setEdit(null)} width={540}
          footer={<><button className="btn" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
            <button className="btn primary" disabled={!edit.name?.trim() || !edit.command?.trim()}
              onClick={async () => { try { await api.SaveSnippet({ ...edit, tags: edit.tags ?? [] }); reload(); setEdit(null) } catch (e) { toast(errMsg(e), 'err') } }}>{t('common.save')}</button></>}>
          <Field label={t('snip.name')}><input className="input" autoFocus value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label={t('snip.command')} hint={t('snip.commandHint')}>
            <textarea className="input" value={edit.command ?? ''} onChange={(e) => setEdit({ ...edit, command: e.target.value })} />
          </Field>
          <Field label={t('hostEditor.tags')} hint={t('hostEditor.tagsHint')}>
            <TagInput value={edit.tags ?? []} onChange={(tags) => setEdit({ ...edit, tags })} placeholder={t('hostEditor.tagsPlaceholder')} />
          </Field>
        </Modal>
      )}
      {del && (
        <Confirm title={t('snip.deleteTitle')} danger confirm={t('snip.deleteConfirm')} onClose={() => setDel(null)}
          onConfirm={async () => { await api.DeleteSnippet(del.id); reload() }}>
          <p style={{ marginTop: 0 }}>{t('snip.deleteBody', { name: del.name })}</p>
        </Confirm>
      )}
    </div>
  )
}
