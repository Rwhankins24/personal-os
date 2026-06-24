import { create } from 'zustand'

// Persist workspace selection across page navigations via localStorage
const savedWorkspace = localStorage.getItem('personal_os_workspace') || 'all'

export const useStore = create((set) => ({
  // Workspace context — 'all' | 'work' | 'personal' | 'other'
  workspace: savedWorkspace,
  setWorkspace: (ws) => {
    localStorage.setItem('personal_os_workspace', ws)
    set({ workspace: ws })
  },

  // Workspace records [{id, name, color}] — loaded once by WorkspaceBar on mount
  workspaces: [],
  setWorkspaces: (list) => set({ workspaces: list }),

  selectedTask: null,
  setSelectedTask: (task) => set({ selectedTask: task }),

  selectedEmail: null,
  setSelectedEmail: (email) => set({ selectedEmail: email }),

  selectedProject: null,
  setSelectedProject: (project) => set({ selectedProject: project }),

  sidebarOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}))
