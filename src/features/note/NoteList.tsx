import { format, isToday, isYesterday } from 'date-fns'
import type { NoteMeta } from '../../domain/note'

interface Props {
  notes: NoteMeta[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

/** 将 ISO 日期格式化为简洁中文（今天/昨天/M月d日） */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (isToday(date)) return '今天'
  if (isYesterday(date)) return '昨天'
  return format(date, 'M月d日')
}

/** 左侧 note 列表侧边栏 */
export function NoteList({ notes, activeId, onSelect, onNew, onDelete }: Props) {
  return (
    <aside className="note-list">
      <div className="note-list-header">
        <span className="app-name">Mira</span>
        <button className="btn-new" onClick={onNew} title="新建笔记">
          +
        </button>
      </div>

      <div className="note-list-items">
        {notes.length === 0 && (
          <div className="note-list-empty">暂无笔记，点击 + 新建</div>
        )}
        {notes.map((meta) => (
          <div
            key={meta.id}
            className={`note-item ${meta.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(meta.id)}
          >
            <div className="note-item-title">{meta.title}</div>
            <div className="note-item-footer">
              <span className="note-item-date">{formatDate(meta.createdAt)}</span>
              <button
                className="btn-delete"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(meta.id)
                }}
                title="删除"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
