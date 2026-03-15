import React from 'react'
import { AppProvider, useApp } from './context/AppContext'
import Sidebar from './components/Sidebar'
import WelcomeScreen from './pages/WelcomeScreen'
import UploadComps from './pages/UploadComps'
import Dashboard from './pages/Dashboard'
import MatchTargets from './pages/MatchTargets'
import MailingList from './pages/MailingList'
import Campaigns from './pages/Campaigns'

function PageContent() {
  const { currentPage, compsStats } = useApp()

  // Show welcome screen only on the dedicated welcome page.
  // Upload Comps must remain reachable even when there is no data yet.
  if (currentPage === 'welcome') {
    return <WelcomeScreen />
  }

  switch (currentPage) {
    case 'upload-comps':
      return <UploadComps />
    case 'dashboard':
      return <Dashboard />
    case 'match-targets':
      return <MatchTargets />
    case 'mailing-list':
      return <MailingList />
    case 'campaigns':
      return <Campaigns />
    default:
      return <WelcomeScreen />
  }
}

export default function App() {
  return (
    <AppProvider>
      <div className="flex min-h-screen" style={{ background: '#F8F6FB' }}>
        <Sidebar />
        <main className="flex-1 overflow-auto" style={{ background: '#F8F6FB' }}>
          <PageContent />
        </main>
      </div>
    </AppProvider>
  )
}
