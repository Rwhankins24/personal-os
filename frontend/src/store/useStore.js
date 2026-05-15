import { create } from 'zustand'

export const useStore = create((set) => ({
  workspace: 'all',
  setWorkspace: (ws) => set({ workspace: ws }),

  selectedTask: null,
  setSelectedTask: (task) => set({ selectedTask: task }),

  selectedEmail: null,
  setSelectedEmail: (email) => set({ selectedEmail: email }),

  selectedProject: null,
  setSelectedProject: (project) => set({ selectedProject: project }),

  sidebarOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}))
