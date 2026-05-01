import React, { useEffect, useState } from 'react'
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
import MailCalendar from './pages/MailCalendar'
import OnboardingWizard from './pages/OnboardingWizard'
import { getSetting, listCrmCampaigns } from './api/crm'

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '40px', fontFamily: 'monospace', background: '#fff', minHeight: '100vh' }}>
          <h2 style={{ color: '#B71C1C', marginBottom: '16px' }}>Runtime Error</h2>
          <pre style={{ background: '#FFF0F0', padding: '16px', borderRadius: '8px', border: '1px solid #FFCDD2', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#1A0A2E', fontSize: '13px' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            style={{ marginTop: '16px', padding: '8px 16px', background: '#5C2977', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function PageContent() {
  const { currentPage } = useApp()

  switch (currentPage) {
    case 'crm-dashboard':    return <CRMDashboard />
    case 'upload-comps':     return <UploadComps />
    case 'dashboard':        return <Dashboard />
    case 'match-targets':    return <MatchTargets />
    case 'mailing-list':     return <MailingList />
    case 'campaigns':        return <CRMCampaigns />
    case 'crm-campaigns':    return <CRMCampaigns />
    case 'crm-properties':   return <Properties />
    case 'crm-contacts':     return <Contacts />
    case 'crm-deals':        return <Deals />
    case 'seller-inbox':     return <SellerInbox />
    case 'buyer-inbox':      return <BuyerInbox />
    case 'boards-seller':    return <Boards view="boards-seller" />
    case 'boards-buyer':     return <Boards view="boards-buyer" />
    case 'boards-inventory': return <Boards view="boards-inventory" />
    case 'mail-calendar':    return <MailCalendar />
    case 'settings':         return <SettingsPage />
    case 'welcome':          return <WelcomeScreen />
    default:                 return <CRMDashboard />
  }
}

function AppShell() {
  const [wizardVisible, setWizardVisible] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    Promise.all([
      getSetting('onboarding_complete').catch(() => null),
      listCrmCampaigns().catch(() => []),
    ]).then(([setting, campaigns]) => {
      const done = (setting as { value?: unknown } | null)?.value === true
      const hasCampaigns = (campaigns as unknown[]).length > 0
      if (!done && !hasCampaigns) {
        setWizardVisible(true)
      }
      setChecked(true)
    })
  }, [])

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#F8F6FB' }}>
        <div className="w-8 h-8 border-2 border-purple-300 border-t-purple-700 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen" style={{ background: '#F8F6FB' }}>
      <Sidebar />
      <main className="flex-1 overflow-auto" style={{ background: '#F8F6FB' }}>
        <ErrorBoundary>
          <PageContent />
        </ErrorBoundary>
      </main>
      <AIAssistant />
      {wizardVisible && <OnboardingWizard onComplete={() => setWizardVisible(false)} />}
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </ErrorBoundary>
  )
}
