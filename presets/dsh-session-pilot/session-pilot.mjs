/**
 * session-model-prompt — session-scoped model selection and prompt editing.
 *
 * Exposes tools that let an agent:
 *   - list available providers/models
 *   - switch the session model (applies from the next step)
 *   - edit its own custom system prompt and runtime context
 *
 * No external imports on purpose: preset-relative plugin rows resolve bare
 * specifiers from the user home, where @deepseek-ai/* is not installed. All
 * services are accessed through the Cordis `ctx` passed to apply().
 */

export const name = 'session-model-prompt'

export const inject = ['systemPrompt', 'tools', 'llm', 'agents']

function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, meta] of Object.entries(spec || {})) {
    const prop = { type: meta.type }
    if (Array.isArray(meta.enum)) prop.enum = meta.enum
    if (meta.description) prop.description = meta.description
    properties[key] = prop
    if (meta.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

export function apply(ctx) {
  const states = new Map() // session/agent id -> { system, context, selectionRef, disposers }

  function stateFor(id) {
    let state = states.get(id)
    if (state === undefined) {
      state = {
        system: '',
        context: '',
        selectionRef: { current: undefined, assembled: undefined },
        disposers: [],
      }
      states.set(id, state)
    }
    return state
  }

  // ── per-agent wiring ─────────────────────────────────────────────────────
  ctx.on('agent/created', ({ agent }) => {
    const state = stateFor(agent.id)

    // Model selection: duplicate @deepseek-ai/dsh-agent's installModelSelection
    // behaviour without importing the package.
    const disposeAssembly = agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const selected = state.selectionRef.current
      const assembled = await next()
      state.selectionRef.assembled = selected
      if (selected === undefined) return assembled
      return {
        ...assembled,
        variables: {
          ...assembled.variables,
          provider: selected.provider,
          model: selected.model,
        },
      }
    })

    const disposeRequest = agent.ctx.on('agent/request', async (_payload, next) => {
      const resolved = await next()
      const selected = state.selectionRef.assembled
      if (selected === undefined) return resolved
      const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
      return {
        ...withoutInheritedEffort,
        provider: selected.provider,
        model: selected.model,
        ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
      }
    })

    state.disposers.push(disposeAssembly, disposeRequest)

    // Custom system prompt section (agent-scoped, stable slot).
    agent.ctx.systemPrompt.section({
      name: 'session-model-prompt:system',
      order: 20,
      text: () => state.system || '',
    })

    // Custom runtime context (agent-scoped, user-role snapshot).
    agent.ctx.systemPrompt.context({
      name: 'session-model-prompt:context',
      order: 200,
      text: () => state.context || '',
    })
  })

  ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent.id)
  })

  // ── tool registration helper ─────────────────────────────────────────────
  const registerTool = (tool) => {
    ctx.effect(() => ctx.tools.register({
      ...tool,
      parameters: toJsonSchema(tool.parameters),
    }))
  }

  // ── model tools ──────────────────────────────────────────────────────────
  registerTool({
    name: 'session_list_models',
    description: 'List currently available AI providers and model IDs that this session can switch to.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute() {
      const providers = ctx.llm.listProviders()
      const lines = []
      for (const provider of providers) {
        try {
          const models = await ctx.llm.listModels(provider.id)
          lines.push(`${provider.id}: ${models.map((m) => m.id).join(', ')}`)
        } catch (error) {
          lines.push(`${provider.id}: (models unavailable: ${error?.message ?? String(error)})`)
        }
      }
      return lines.length ? lines.join('\n') : '(no providers available)'
    },
  })

  registerTool({
    name: 'session_set_model',
    description: 'Switch this session to a different model. The change applies from the next step. Use session_list_models to see valid provider/model ids.',
    parameters: {
      provider: { type: 'string', required: true, description: 'Provider route id' },
      model: { type: 'string', required: true, description: 'Exact model id accepted by the provider' },
      reasoning_effort: { type: 'string', description: 'Optional reasoning effort accepted by the exact model' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args, exec) {
      const agent = exec?.agent
      if (agent === undefined) return 'error: no agent context'
      const state = stateFor(agent.id)
      try {
        const resolved = await ctx.llm.resolveCallConfig({
          provider: args.provider,
          model: args.model,
          ...(args.reasoning_effort === undefined ? {} : { reasoningEffort: args.reasoning_effort }),
        })
        state.selectionRef.current = {
          provider: resolved.provider,
          model: resolved.model,
          ...(resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort }),
        }
        const effort = resolved.reasoningEffort === undefined ? '' : ` (reasoningEffort=${resolved.reasoningEffort})`
        return `model switch queued: ${resolved.provider}/${resolved.model}${effort} — applies on the next step`
      } catch (error) {
        return `model switch failed: ${error?.message ?? String(error)}`
      }
    },
  })

  // ── prompt orchestration tools ───────────────────────────────────────────
  registerTool({
    name: 'prompt_set_system',
    description: 'Replace this session\'s custom system-prompt text. Empty text clears it. This is a persistent system-prompt section.',
    parameters: {
      text: { type: 'string', required: true, description: 'The full custom system prompt text' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute(args, exec) {
      const agent = exec?.agent
      if (agent === undefined) return 'error: no agent context'
      stateFor(agent.id).system = String(args.text ?? '')
      return 'system prompt updated'
    },
  })

  registerTool({
    name: 'prompt_append_system',
    description: 'Append text to this session\'s custom system prompt.',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to append' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute(args, exec) {
      const agent = exec?.agent
      if (agent === undefined) return 'error: no agent context'
      const state = stateFor(agent.id)
      state.system = state.system ? `${state.system}\n${String(args.text ?? '')}` : String(args.text ?? '')
      return 'system prompt appended'
    },
  })

  registerTool({
    name: 'prompt_set_context',
    description: 'Replace this session\'s custom runtime context text. Empty text clears it. Runtime context is injected as a user-role snapshot before each request.',
    parameters: {
      text: { type: 'string', required: true, description: 'The full custom runtime context text' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute(args, exec) {
      const agent = exec?.agent
      if (agent === undefined) return 'error: no agent context'
      stateFor(agent.id).context = String(args.text ?? '')
      return 'runtime context updated'
    },
  })

  registerTool({
    name: 'prompt_append_context',
    description: 'Append text to this session\'s custom runtime context.',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to append' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute(args, exec) {
      const agent = exec?.agent
      if (agent === undefined) return 'error: no agent context'
      const state = stateFor(agent.id)
      state.context = state.context ? `${state.context}\n${String(args.text ?? '')}` : String(args.text ?? '')
      return 'runtime context appended'
    },
  })

  registerTool({
    name: 'prompt_clear',
    description: 'Clear this session\'s custom system prompt and runtime context.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute(_args, exec) {
      const agent = exec?.agent
      if (agent === undefined) return 'error: no agent context'
      const state = stateFor(agent.id)
      state.system = ''
      state.context = ''
      return 'custom prompt state cleared'
    },
  })

  registerTool({
    name: 'prompt_status',
    description: 'Show this session\'s current custom system prompt and runtime context, and the queued model selection.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute(_args, exec) {
      const agent = exec?.agent
      if (agent === undefined) return 'error: no agent context'
      const state = stateFor(agent.id)
      const selection = state.selectionRef.current
      return [
        `model=${selection ? `${selection.provider}/${selection.model}${selection.reasoningEffort ? ` (${selection.reasoningEffort})` : ''}` : '(inherited)'}`,
        `system=${state.system ? '\n' + state.system : '(empty)'}`,
        `context=${state.context ? '\n' + state.context : '(empty)'}`,
      ].join('\n')
    },
  })
}
