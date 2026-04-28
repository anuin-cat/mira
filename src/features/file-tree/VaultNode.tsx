import { useEffect, useRef } from 'react'
import type { MouseEvent } from 'react'
import type { NodeRendererProps } from 'react-arborist'
import type { VaultTreeNode } from '../../domain/note'
import { isImeComposing } from '../../lib/keyboard'

interface VaultNodeProps extends NodeRendererProps<VaultTreeNode> {
  onContextMenuOpen: (event: MouseEvent, node: VaultTreeNode) => void
  onSelectNode: (node: VaultTreeNode) => void
}

/** 文件树节点渲染，目录点击展开，文件点击打开 */
export function VaultNode({
  node,
  style,
  dragHandle,
  onContextMenuOpen,
  onSelectNode,
}: VaultNodeProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const submittedRef = useRef(false)
  const data = node.data
  const isDirectory = data.kind === 'directory'

  useEffect(() => {
    if (!node.isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [node.isEditing])

  function handleNodeClick(event: MouseEvent) {
    event.stopPropagation()
    onSelectNode(data)
    if (isDirectory) {
      node.toggle()
      return
    }
    node.handleClick(event)
  }

  function submitRename() {
    if (submittedRef.current) return
    submittedRef.current = true
    node.submit(inputRef.current?.value ?? '')
  }

  return (
    <div
      ref={dragHandle}
      style={style}
      className={['tree-node', node.isSelected ? 'active' : ''].join(' ')}
      data-path={data.path}
      data-kind={data.kind}
      onClick={handleNodeClick}
      onContextMenu={(event) => onContextMenuOpen(event, data)}
    >
      <button
        type="button"
        className={`tree-node-toggle ${isDirectory ? '' : 'hidden'} ${node.isOpen ? 'open' : ''}`}
        onClick={(event) => {
          event.stopPropagation()
          node.toggle()
        }}
        tabIndex={-1}
      />
      <span className={`tree-node-icon ${isDirectory ? 'directory' : 'file'}`} />
      {node.isEditing ? (
        <input
          ref={inputRef}
          className="tree-node-input"
          defaultValue={data.name}
          onBlur={submitRename}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              submittedRef.current = true
              node.reset()
            }
            if (event.key === 'Enter' && !isImeComposing(event)) submitRename()
          }}
        />
      ) : (
        <span className="tree-node-name">{data.name}</span>
      )}
    </div>
  )
}
