import React from 'react'
import { AppProvider, useApp } from './context/AppContext'
import Sidebar from './components/Sidebar'
import WelcomeScreen from './pages/WelcomeScreen'
import UploadComps from './pages/UploadComps'
import Dashboard from './pages/Dashboard'
import MatchTargets from './pages/MatchTargets'
import MailingList from './pages/MailingList'
import Campaigns from './pages/Campaigns'
import Properties from './pages/Properties'
import Contacts from './pages/Contacts'
import Deals from './pages/Deals'

function PageContent() {
  const { currentPage } = useApp()

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
    case 'crm-properties':
      return <Properties />
    case 'crm-contacts':
      return <Contacts />
    case 'crm-deals':
      return <Deals />
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
