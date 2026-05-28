import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import QAReview from './pages/QAReview'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/review/:id" element={<QAReview />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App