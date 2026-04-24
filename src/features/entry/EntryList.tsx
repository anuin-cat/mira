import { format, isToday, isYesterday } from 'date-fns'
import type { EntryMeta } from '../../domain/entry'

interface Props {
  entries: EntryMeta[]
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

/** 左侧 entry 列表侧边栏 */
export function EntryList({ entries, activeId, onSelect, onNew, onDelete }: Props) {
  return (
    <aside className="entry-list">
      <div className="entry-list-header">
        <span className="app-name">Mira</span>
        <button className="btn-new" onClick={onNew} title="新建笔记">
          +
        </button>
      </div>

      <div className="entry-list-items">
        {entries.length === 0 && (
          <div className="entry-list-empty">暂无笔记，点击 + 新建</div>
        )}
        {entries.map((meta) => (
          <div
            key={meta.id}
            className={`entry-item ${meta.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(meta.id)}
          >
            <div className="entry-item-title">{meta.title}</div>
            <div className="entry-item-footer">
              <span className="entry-item-date">{formatDate(meta.createdAt)}</span>
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
