// WorkspaceBar — shared workspace context switcher
// Reads/writes workspace from Zustand global store.
// Loads workspace IDs from API once on mount and stores them.
// Used on Dashboard (full) and all sub-pages (compact).
//
// Props:
//   compact — boolean, default false. Compact = smaller pills, no label.

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useStore } from '../store/useStore'
import { getWorkspaces } from '../lib/api'

const WORKSPACE_META = {
  all:      { label: 'All',      dot: null },
  work:     { label: 'Work',     dot: '#185FA5' },
  personal: { label: 'Personal', dot: '#3B6D11' },
  other:    { label: 'Other',    dot: '#854F0B' },
}

export default function WorkspaceBar({ compact = false }) {
  const { workspace, setWorkspace, setWorkspaces } = useStore()

  const { data: workspaceList = [] } = useQuery({
    queryKey: ['workspaces'],
    queryFn: getWorkspaces,
    staleTime: Infinity, // workspaces never change at runtime
  })

  // Store workspace list (with IDs) in Zustand so pages can resolve name → UUID
  useEffect(() => {
    if (workspaceList.length > 0) setWorkspaces(workspaceList)
  }, [workspaceList, setWorkspaces])

  const tabs = ['all', 'work', 'personal', 'other']

  return (
    <div className="flex items-center gap-1">
      {tabs.map(tab => {
        const meta = WORKSPACE_META[tab]
        const active = workspace === tab
        return (
          <button
            key={tab}
            onClick={() => setWorkspace(tab)}
            className={`flex items-center gap-1.5 rounded-lg font-medium transition-all capitalize
              ${compact ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'}
              ${active
                ? 'bg-[#1a1a18] text-white'
                : 'text-[#6b6b67] hover:text-[#1a1a18] hover:bg-[#f0f0ee]'
              }`}
          >
            {meta.dot && (
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: active ? 'white' : meta.dot }}
              />
            )}
            {meta.label}
          </button>
        )
      })}
    </div>
  )
}
