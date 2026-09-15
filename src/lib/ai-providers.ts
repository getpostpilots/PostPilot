export type AiProvider = {
  id: string
  label: string
  transport: 'anthropic' | 'openai'
  baseUrl: string | null
  defaultModel: string
  keyHint: string
  // Can this provider also generate a supporting image for a draft?
  // See src/lib/image-ai.ts - currently only Gemini's native image model.
  supportsImages?: boolean
}

// BYO-key providers. `transport` picks which request shape lib/ai.ts uses;
// everything except Anthropic speaks the OpenAI-compatible chat API.
export const AI_PROVIDERS: AiProvider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    transport: 'anthropic',
    baseUrl: null,
    defaultModel: 'claude-sonnet-4-5',
    keyHint: 'console.anthropic.com - key starts with sk-ant-',
  },
  {
    id: 'gemini',
    label: 'Google (Gemini) - text + supporting images',
    transport: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash',
    keyHint: 'aistudio.google.com/apikey - key starts with AIza',
    supportsImages: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    transport: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    keyHint: 'platform.openai.com - key starts with sk-',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (any model, one key)',
    transport: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    keyHint: 'openrouter.ai/keys',
  },
  {
    id: 'groq',
    label: 'Groq (fast, cheap Llama)',
    transport: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    keyHint: 'console.groq.com/keys',
  },
  {
    id: 'custom',
    label: 'Other / self-hosted',
    transport: 'openai',
    baseUrl: null,
    defaultModel: 'llama-3.3-70b',
    keyHint: 'Any endpoint that speaks the OpenAI chat API',
  },
]

export function getProvider(id: string): AiProvider {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0]
}
