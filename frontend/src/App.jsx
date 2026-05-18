import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard   from './pages/Dashboard'
import TaskDetail  from './pages/TaskDetail'
import ProjectCard from './pages/ProjectCard'
import ContactCard from './pages/ContactCard'
import Contacts    from './pages/Contacts'

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
          <Route path="/contacts"       element={<Contacts />} />
          <Route path="/contact/:id"    element={<ContactCard />} />
          <Route path="/contacts/:id"   element={<ContactCard />} />
          <Route path="/task/:id"       element={<TaskDetail />} />
          <Route path="/project/:id"    element={<ProjectCard />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
