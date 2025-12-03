import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type { AgentConfig, BattleEvent } from './types'
import type { Sandbox } from '@vercel/sandbox'

// Tool definition for bash execution
const BASH_TOOL_NAME = 'execute_bash'

const BASH_TOOL_DESCRIPTION = `Execute a bash command in your sandbox environment. 
You have access to common tools like curl, nmap, nc, etc.
Use --socks5 localhost:1055 with curl to route traffic through Tailscale.
Returns the command output (truncated to last 500 chars if longer).`

// System prompt for the battle
function getSystemPrompt(towerIp: string, agentId: string): string {
  return `You are an AI agent in a battle arena. Your goal is to defeat the tower server.

MISSION:
- You have access to a remote server at IP: ${towerIp}
- You must discover what port is open and what endpoint to call
- Use the execute_bash tool to run commands in your sandbox
- Your agent ID is: ${agentId}

HINTS:
- Start by scanning the server to find open ports
- Try to discover what endpoints are available
- When making HTTP requests, use: curl --socks5 localhost:1055 <url>
- Include your agent ID in requests using the X-Agent-ID header

WIN CONDITION:
- Call the correct endpoint enough times to deplete the tower's health
- Each successful request does damage to the tower

Be efficient and strategic. Good luck!`
}

// OpenAI tool schema
const openaiTool: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: BASH_TOOL_NAME,
    description: BASH_TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute',
        },
        background: {
          type: 'boolean',
          description: 'Run the command in background (default: false)',
          default: false,
        },
      },
      required: ['command'],
    },
  },
}

// Anthropic tool schema
const anthropicTool: Anthropic.Tool = {
  name: BASH_TOOL_NAME,
  description: BASH_TOOL_DESCRIPTION,
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
      },
      background: {
        type: 'boolean',
        description: 'Run the command in background (default: false)',
      },
    },
    required: ['command'],
  },
}

// Execute bash command in sandbox
async function executeBash(
  sandbox: Sandbox,
  command: string,
  background: boolean = false
): Promise<{ output: string; exitCode: number }> {
  let output = ''
  const { Writable } = require('stream')

  const stdoutStream = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      output += chunk.toString()
      callback()
    },
  })

  const stderrStream = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      output += chunk.toString()
      callback()
    },
  })

  try {
    if (background) {
      // Run in background using nohup
      await sandbox.runCommand({
        cmd: 'bash',
        args: ['-c', `nohup ${command} > /dev/null 2>&1 &`],
        stdout: stdoutStream,
        stderr: stderrStream,
      })
      return { output: 'Command started in background', exitCode: 0 }
    }

    const result = await sandbox.runCommand({
      cmd: 'bash',
      args: ['-c', command],
      stdout: stdoutStream,
      stderr: stderrStream,
    })

    // Truncate output to last 500 chars
    const truncatedOutput = output.length > 500
      ? '...' + output.slice(-500)
      : output

    return { output: truncatedOutput || '(no output)', exitCode: result.exitCode }
  } catch (error) {
    return {
      output: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      exitCode: 1
    }
  }
}

// Token usage tracking
interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

// Event emitter type
type EmitEvent = (event: BattleEvent) => Promise<void>

// Run OpenAI agent
async function runOpenAIAgent(
  agent: AgentConfig,
  towerIp: string,
  sandbox: Sandbox,
  emit: EmitEvent,
  isBattleActive: () => Promise<boolean>
): Promise<TokenUsage> {
  const client = new OpenAI()
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: getSystemPrompt(towerIp, agent.id) },
  ]

  while (await isBattleActive()) {
    try {
      const response = await client.chat.completions.create({
        model: agent.model,
        messages,
        tools: [openaiTool],
        tool_choice: 'auto',
      })

      const choice = response.choices[0]
      const message = choice.message

      // Track token usage
      if (response.usage) {
        totalUsage.inputTokens += response.usage.prompt_tokens
        totalUsage.outputTokens += response.usage.completion_tokens
        totalUsage.totalTokens += response.usage.total_tokens

        await emit({
          type: 'agent:tokens',
          timestamp: Date.now(),
          agentId: agent.id,
          data: {
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            totalTokens: totalUsage.totalTokens,
          },
        })
      }

      // Emit thinking if there's content
      if (message.content) {
        await emit({
          type: 'agent:thinking',
          timestamp: Date.now(),
          agentId: agent.id,
          message: message.content,
        })
      }

      // Add assistant message to history
      messages.push(message)

      // Handle tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.function.name === BASH_TOOL_NAME) {
            const args = JSON.parse(toolCall.function.arguments)

            await emit({
              type: 'agent:log',
              timestamp: Date.now(),
              agentId: agent.id,
              message: `$ ${args.command}`,
            })

            const result = await executeBash(sandbox, args.command, args.background)

            await emit({
              type: 'agent:log',
              timestamp: Date.now(),
              agentId: agent.id,
              message: result.output || '(no output)',
            })

            // Add tool result to messages
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Exit code: ${result.exitCode}\nOutput:\n${result.output}`,
            })
          }
        }
      } else if (choice.finish_reason === 'stop') {
        // Model finished without tool call, prompt it to continue
        messages.push({
          role: 'user',
          content: 'Continue attacking the tower. Use the execute_bash tool to make more requests.',
        })
      }
    } catch (error) {
      await emit({
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: `LLM Error: ${error instanceof Error ? error.message : 'Unknown'}`,
      })
      // Wait before retrying
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  return totalUsage
}

// Run Anthropic agent
async function runAnthropicAgent(
  agent: AgentConfig,
  towerIp: string,
  sandbox: Sandbox,
  emit: EmitEvent,
  isBattleActive: () => Promise<boolean>
): Promise<TokenUsage> {
  const client = new Anthropic()
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

  const messages: Anthropic.MessageParam[] = []

  while (await isBattleActive()) {
    try {
      const response = await client.messages.create({
        model: agent.model,
        max_tokens: 4096,
        system: getSystemPrompt(towerIp, agent.id),
        messages,
        tools: [anthropicTool],
      })

      // Track token usage
      totalUsage.inputTokens += response.usage.input_tokens
      totalUsage.outputTokens += response.usage.output_tokens
      totalUsage.totalTokens += response.usage.input_tokens + response.usage.output_tokens

      await emit({
        type: 'agent:tokens',
        timestamp: Date.now(),
        agentId: agent.id,
        data: {
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
          totalTokens: totalUsage.totalTokens,
        },
      })

      // Process content blocks
      const assistantContent: Anthropic.ContentBlockParam[] = []
      const toolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = []

      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          await emit({
            type: 'agent:thinking',
            timestamp: Date.now(),
            agentId: agent.id,
            message: block.text,
          })
          assistantContent.push({ type: 'text', text: block.text })
        } else if (block.type === 'tool_use') {
          assistantContent.push(block)

          const args = block.input as { command: string; background?: boolean }

          await emit({
            type: 'agent:log',
            timestamp: Date.now(),
            agentId: agent.id,
            message: `$ ${args.command}`,
          })

          const result = await executeBash(sandbox, args.command, args.background)

          await emit({
            type: 'agent:log',
            timestamp: Date.now(),
            agentId: agent.id,
            message: result.output || '(no output)',
          })

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Exit code: ${result.exitCode}\nOutput:\n${result.output}`,
          })
        }
      }

      // Add assistant message
      messages.push({ role: 'assistant', content: assistantContent })

      // Add tool results if any
      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults })
      } else if (response.stop_reason === 'end_turn') {
        // Model finished without tool call
        messages.push({
          role: 'user',
          content: 'Continue attacking the tower. Use the execute_bash tool to make more requests.',
        })
      }
    } catch (error) {
      await emit({
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: `LLM Error: ${error instanceof Error ? error.message : 'Unknown'}`,
      })
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  return totalUsage
}

// Run xAI agent (OpenAI-compatible API)
async function runXAIAgent(
  agent: AgentConfig,
  towerIp: string,
  sandbox: Sandbox,
  emit: EmitEvent,
  isBattleActive: () => Promise<boolean>
): Promise<TokenUsage> {
  const client = new OpenAI({
    baseURL: 'https://api.x.ai/v1',
    apiKey: process.env.XAI_API_KEY,
  })
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: getSystemPrompt(towerIp, agent.id) },
  ]

  while (await isBattleActive()) {
    try {
      const response = await client.chat.completions.create({
        model: agent.model,
        messages,
        tools: [openaiTool],
        tool_choice: 'auto',
      })

      const choice = response.choices[0]
      const message = choice.message

      // Track token usage
      if (response.usage) {
        totalUsage.inputTokens += response.usage.prompt_tokens
        totalUsage.outputTokens += response.usage.completion_tokens
        totalUsage.totalTokens += response.usage.total_tokens

        await emit({
          type: 'agent:tokens',
          timestamp: Date.now(),
          agentId: agent.id,
          data: {
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            totalTokens: totalUsage.totalTokens,
          },
        })
      }

      if (message.content) {
        await emit({
          type: 'agent:thinking',
          timestamp: Date.now(),
          agentId: agent.id,
          message: message.content,
        })
      }

      messages.push(message)

      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.function.name === BASH_TOOL_NAME) {
            const args = JSON.parse(toolCall.function.arguments)

            await emit({
              type: 'agent:log',
              timestamp: Date.now(),
              agentId: agent.id,
              message: `$ ${args.command}`,
            })

            const result = await executeBash(sandbox, args.command, args.background)

            await emit({
              type: 'agent:log',
              timestamp: Date.now(),
              agentId: agent.id,
              message: result.output || '(no output)',
            })

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Exit code: ${result.exitCode}\nOutput:\n${result.output}`,
            })
          }
        }
      } else if (choice.finish_reason === 'stop') {
        messages.push({
          role: 'user',
          content: 'Continue attacking the tower. Use the execute_bash tool to make more requests.',
        })
      }
    } catch (error) {
      await emit({
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: `LLM Error: ${error instanceof Error ? error.message : 'Unknown'}`,
      })
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  return totalUsage
}

// Run Google agent (using OpenAI compatibility layer for now)
async function runGoogleAgent(
  agent: AgentConfig,
  towerIp: string,
  sandbox: Sandbox,
  emit: EmitEvent,
  isBattleActive: () => Promise<boolean>
): Promise<TokenUsage> {
  // Google's Gemini API has OpenAI compatibility mode
  const client = new OpenAI({
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKey: process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY,
  })
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: getSystemPrompt(towerIp, agent.id) },
  ]

  while (await isBattleActive()) {
    try {
      const response = await client.chat.completions.create({
        model: agent.model,
        messages,
        tools: [openaiTool],
        tool_choice: 'auto',
      })

      const choice = response.choices[0]
      const message = choice.message

      if (response.usage) {
        totalUsage.inputTokens += response.usage.prompt_tokens
        totalUsage.outputTokens += response.usage.completion_tokens
        totalUsage.totalTokens += response.usage.total_tokens

        await emit({
          type: 'agent:tokens',
          timestamp: Date.now(),
          agentId: agent.id,
          data: {
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            totalTokens: totalUsage.totalTokens,
          },
        })
      }

      if (message.content) {
        await emit({
          type: 'agent:thinking',
          timestamp: Date.now(),
          agentId: agent.id,
          message: message.content,
        })
      }

      messages.push(message)

      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.function.name === BASH_TOOL_NAME) {
            const args = JSON.parse(toolCall.function.arguments)

            await emit({
              type: 'agent:log',
              timestamp: Date.now(),
              agentId: agent.id,
              message: `$ ${args.command}`,
            })

            const result = await executeBash(sandbox, args.command, args.background)

            await emit({
              type: 'agent:log',
              timestamp: Date.now(),
              agentId: agent.id,
              message: result.output || '(no output)',
            })

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Exit code: ${result.exitCode}\nOutput:\n${result.output}`,
            })
          }
        }
      } else if (choice.finish_reason === 'stop') {
        messages.push({
          role: 'user',
          content: 'Continue attacking the tower. Use the execute_bash tool to make more requests.',
        })
      }
    } catch (error) {
      await emit({
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: `LLM Error: ${error instanceof Error ? error.message : 'Unknown'}`,
      })
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  return totalUsage
}

// Main entry point - run agent based on provider
export async function runLLMAgent(
  agent: AgentConfig,
  towerIp: string,
  sandbox: Sandbox,
  emit: EmitEvent,
  isBattleActive: () => Promise<boolean>
): Promise<TokenUsage> {
  await emit({
    type: 'agent:log',
    timestamp: Date.now(),
    agentId: agent.id,
    message: `Starting ${agent.name} (${agent.model})...`,
  })

  switch (agent.provider) {
    case 'openai':
      return runOpenAIAgent(agent, towerIp, sandbox, emit, isBattleActive)
    case 'anthropic':
      return runAnthropicAgent(agent, towerIp, sandbox, emit, isBattleActive)
    case 'xai':
      return runXAIAgent(agent, towerIp, sandbox, emit, isBattleActive)
    case 'google':
      return runGoogleAgent(agent, towerIp, sandbox, emit, isBattleActive)
    default:
      throw new Error(`Unknown provider: ${agent.provider}`)
  }
}
