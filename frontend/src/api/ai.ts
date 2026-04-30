import api from './client'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function sendChatMessage(messages: ChatMessage[]): Promise<string> {
  const { data } = await api.post<{ response: string }>('/ai/chat', { messages })
  return data.response
}
