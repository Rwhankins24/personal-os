import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard   from './pages/Dashboard'
import TaskDetail  from './pages/TaskDetail'
import ProjectCard from './pages/ProjectCard'
import ContactCard from './pages/ContactCard'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutes
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/"               element={<Dashboard />} />
          <Route path="/task/:id"       element={<TaskDetail />} />
          <Route path="/project/:id"    element={<ProjectCard />} />
          <Route path="/contact/:id"    element={<ContactCard />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
