import React from 'react'
import { AppProvider, useApp } from './context/AppContext'
import Sidebar from './components/Sidebar'
import AIAssistant from './components/AIAssistant'
import WelcomeScreen from './pages/WelcomeScreen'
import UploadComps from './pages/UploadComps'
import Dashboard from './pages/Dashboard'
import MatchTargets from './pages/MatchTargets'
import MailingList from './pages/MailingList'
import Campaigns from './pages/Campaigns'
import Properties from './pages/Properties'
import CRMCampaigns from './pages/CRMCampaigns'
import Contacts from './pages/Contacts'
import Deals from './pages/Deals'
import CRMDashboard from './pages/CRMDashboard'
import SellerInbox from './pages/SellerInbox'
import BuyerInbox from './pages/BuyerInbox'
import Boards from './pages/Boards'
import SettingsPage from './pages/SettingsPage'

function PageContent() {
  const { currentPage } = useApp()

  switch (currentPage) {
    case 'crm-dashboard':    return <CRMDashboard />
    case 'upload-comps':     return <UploadComps />
    case 'dashboard':        return <Dashboard />
    case 'match-targets':    return <MatchTargets />
    case 'mailing-list':     return <MailingList />
    case 'campaigns':        return <Campaigns />
    case 'crm-campaigns':    return <CRMCampaigns />
    case 'crm-properties':   return <Properties />
    case 'crm-contacts':     return <Contacts />
    case 'crm-deals':        return <Deals />
    case 'seller-inbox':     return <SellerInbox />
    case 'buyer-inbox':      return <BuyerInbox />
    case 'boards-seller':    return <Boards view="boards-seller" />
    case 'boards-buyer':     return <Boards view="boards-buyer" />
    case 'boards-inventory': return <Boards view="boards-inventory" />
    case 'settings':         return <SettingsPage />
    case 'welcome':          return <WelcomeScreen />
    default:                 return <CRMDashboard />
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
        <AIAssistant />
      </div>
    </AppProvider>
  )
}
