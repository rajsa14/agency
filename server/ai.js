// AI providers. Anthropic is the real one; the key lives only in the server's environment (ANTHROPIC_API_KEY).
// "dev" is a stand-in for building and testing the office without a key: it never calls a model and says so in its output.
import Anthropic from '@anthropic-ai/sdk'

export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' },
]
export const DEFAULT_MODEL = 'claude-opus-5-5'

// Models whose safety classifiers can decline a request and that support re-running it on Anthropic's recommended fallback.
const WITH_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1'])

export class RunError extends Error {}

export const providers = (env) => [{ id: 'anthropic', name: 'Anthropic (Claude)', configured: Boolean(env.ANTHROPIC_API_KEY), variable: 'ANTHROPIC_API_KEY' }]

export const resolveProvider = (env, devMode) => (env.ANTHROPIC_API_KEY ? 'anthropic' : devMode ? 'dev' : null)

const client = (env) => new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 2, timeout: 10 * 60 * 1000 })

const params = (model, body) => (WITH_FALLBACK.has(model) ? { ...body, model, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : { ...body, model })

function explain(error) {
  if (error instanceof RunError) return error.message
  if (error instanceof Anthropic.AuthenticationError) return 'API klíč Anthropic není platný. Zkontroluj ANTHROPIC_API_KEY na serveru.'
  if (error instanceof Anthropic.PermissionDeniedError) return 'API klíč nemá k tomuto modelu přístup.'
  if (error instanceof Anthropic.NotFoundError) return 'Model nebyl nalezen. Vyber v nastavení agenta jiný model.'
  if (error instanceof Anthropic.RateLimitError) return 'Anthropic hlásí překročený limit požadavků. Zkus to za chvíli znovu.'
  if (error instanceof Anthropic.BadRequestError) return `Anthropic požadavek odmítl: ${error.message}`
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'Model neodpověděl včas. Zkus to znovu.'
  if (error instanceof Anthropic.APIConnectionError) return 'Nepodařilo se spojit s Anthropic API.'
  if (error instanceof Anthropic.APIError) return `Chyba Anthropic API (${error.status ?? '?'}): ${error.message}`
  return 'Úkol se nepodařilo zpracovat.'
}

export const isAbort = (error) => error instanceof Anthropic.APIUserAbortError || error?.name === 'AbortError'

async function anthropicText({ env, model, system, user, webSearch, signal, onEvent }) {
  const api = client(env)
  const search = model === 'claude-haiku-5-5' ? 'web_search_20250305' : 'web_search_20260209'
  const tools = webSearch ? [{ type: search, name: 'web_search', max_uses: 6 }] : undefined
  const messages = [{ role: 'user', content: user }]
  let text = ''
  let inputTokens = 0
  let outputTokens = 0
  // A long web search can pause the turn; the paused turn is sent back so the model continues it.
  for (let turn = 0; turn < 6; turn++) {
    const stream = api.beta.messages.stream(params(model, { max_tokens: 64000, system, messages, ...(tools && { tools }) }), { signal })
    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const kind = event.content_block.type
        if (kind === 'thinking') onEvent({ type: 'status', status: 'thinking', activity: 'Přemýšlí' })
        else if (kind === 'server_tool_use') onEvent({ type: 'status', status: 'working', activity: 'Hledá na webu' })
        else if (kind === 'text') onEvent({ type: 'status', status: 'working', activity: 'Píše výsledek' })
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
        onEvent({ type: 'delta', text: event.delta.text })
      }
    }
    const message = await stream.finalMessage()
    inputTokens += message.usage.input_tokens
    outputTokens += message.usage.output_tokens
    if (message.stop_reason === 'refusal') throw new RunError(`Model úkol odmítl zpracovat${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : '.'}`)
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content })
      continue
    }
    return { text, inputTokens, outputTokens, model: message.model, truncated: message.stop_reason === 'max_tokens' }
  }
  throw new RunError('Model práci nedokončil ani po několika pokračováních.')
}

async function anthropicPlan({ env, model, system, user, schema, signal }) {
  const response = await client(env).beta.messages.create(
    params(model, { max_tokens: 16000, system, messages: [{ role: 'user', content: user }], output_config: { format: { type: 'json_schema', schema } } }),
    { signal },
  )
  if (response.stop_reason === 'refusal') throw new RunError('Model požadavek odmítl zpracovat.')
  if (response.stop_reason === 'max_tokens') throw new RunError('Plán byl příliš dlouhý a model ho nedopsal. Zkus požadavek zúžit.')
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  let plan
  try {
    plan = JSON.parse(text)
  } catch {
    throw new RunError('Manažer vrátil plán v nečitelném tvaru. Zkus to znovu.')
  }
  return { plan, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, model: response.model }
}

const pause = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))), { once: true })
  })

async function devText({ user, signal, onEvent }) {
  const text = `> **Vývojový režim.** Tento výstup nevytvořila AI. Na serveru není nastaven žádný AI poskytovatel, takže se úkol jen prošel celým procesem kanceláře. Skutečný výsledek dostaneš po nastavení \`ANTHROPIC_API_KEY\`.\n\n## Co by agent dostal jako zadání\n\n${user}\n`
  onEvent({ type: 'status', status: 'thinking', activity: 'Přemýšlí (ukázka)' })
  await pause(900, signal)
  onEvent({ type: 'status', status: 'working', activity: 'Píše výsledek (ukázka)' })
  for (let i = 0; i < text.length; i += 48) {
    await pause(70, signal)
    onEvent({ type: 'delta', text: text.slice(i, i + 48) })
  }
  return { text, inputTokens: 0, outputTokens: 0, model: 'dev', truncated: false }
}

// No model here: the request is handed to at most three agents whose role or description shares words with it.
async function devPlan({ request, agents, signal }) {
  await pause(700, signal)
  const words = request.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3)
  const ranked = agents
    .map((a) => ({ a, score: words.filter((w) => `${a.role} ${a.department} ${a.description}`.toLowerCase().includes(w)).length }))
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
  const tasks = ranked.map(({ a }, i) => ({
    key: `t${i + 1}`,
    title: `${a.role}: ${request.slice(0, 60)}`,
    description: `Ukázkový dílčí úkol z vývojového režimu. Původní požadavek:\n\n${request}`,
    agent_id: a.id,
    priority: 'normal',
    depends_on: i ? [`t${i}`] : [],
  }))
  return { plan: { summary: 'Vývojový režim: tento plán nesestavila AI. Požadavek je rozdělen mechanicky, aby šel vyzkoušet celý postup.', tasks }, inputTokens: 0, outputTokens: 0, model: 'dev' }
}

function guard(run) {
  return async (options) => {
    try {
      return await run(options)
    } catch (error) {
      if (isAbort(error) || options.signal?.aborted) throw error
      if (!(error instanceof RunError)) console.error('[ai]', error.status ?? '', error.message)
      throw new RunError(explain(error))
    }
  }
}

export const runText = guard((o) => (o.provider === 'dev' ? devText(o) : anthropicText(o)))
export const runPlan = guard((o) => (o.provider === 'dev' ? devPlan(o) : anthropicPlan(o)))
