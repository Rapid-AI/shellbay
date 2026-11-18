import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { loadLanguageExtension, type LanguageId } from '../langDetect'

const langCompartment = new Compartment()

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--panel-2)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--text)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-gutters': { backgroundColor: 'var(--panel-2)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--hover)' },
}, { dark: true })

export default function CodeEditor({ value, onChange, languageId, readOnly, onSave }: {
  value: string
  onChange: (v: string) => void
  languageId: LanguageId
  readOnly?: boolean
  onSave?: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        bracketMatching(),
        indentOnInput(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => { onSaveRef.current?.(); return true } },
          indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap,
        ]),
        EditorView.lineWrapping,
        EditorState.readOnly.of(!!readOnly),
        baseTheme,
        langCompartment.of([]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString())
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap the language extension in place (via the Compartment) so the
  // selector doesn't remount the editor and lose cursor/undo history.
  useEffect(() => {
    let alive = true
    loadLanguageExtension(languageId).then((ext) => {
      if (!alive || !viewRef.current) return
      viewRef.current.dispatch({ effects: langCompartment.reconfigure(ext) })
    })
    return () => { alive = false }
  }, [languageId])

  // Keep an externally-changed value (e.g. file reloaded) in sync without
  // fighting the user's own typing: only reset when it actually differs.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  return <div className="code-editor" ref={hostRef} />
}
