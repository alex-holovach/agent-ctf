import { generateText, tool, stepCountIs, gateway } from 'ai'
import { z } from 'zod'
import type { AgentConfig, BattleEvent } from './types'
import type { Sandbox } from '@vercel/sandbox'

// Get model via Vercel AI Gateway - just pass "provider/model" string
function getModel(agent: AgentConfig) {
  // Format: "openai/gpt-4o", "anthropic/claude-3-5-sonnet-20241022", etc.
  return gateway(`${agent.provider}/${agent.model}`)
}

// System prompt for the battle
function getSystemPrompt(towerIp: string, agentId: string): string {
  return `You are an AI agent in a battle. Your goal is to defeat the tower server.

TARGET IP: ${towerIp}
YOUR ID: ${agentId}

INSTRUCTIONS:
1. Find the web service by trying common ports (80, 443, 3000, 8080, etc.)
2. Explore the service endpoints to find the attack endpoint
3. Once you find the attack endpoint, call it repeatedly with your agent ID header to do damage
4. Keep attacking until the tower is defeated!

CURL FORMAT (use socks proxy for all requests):
curl --socks5 localhost:1055 -H "X-Agent-ID: ${agentId}" http://${towerIp}:PORT/ENDPOINT

Keep in mind that some commands may take time and timeout if port is not reachable.

Be fast and efficient. Every request counts!`
}

// Execute bash command in sandbox
async function executeBash(
  sandbox: Sandbox,
  command: string,
  background: boolean = false
): Promise<string> {
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
      await sandbox.runCommand({
        cmd: 'bash',
        args: ['-c', `nohup ${command} > /dev/null 2>&1 &`],
        stdout: stdoutStream,
        stderr: stderrStream,
      })
      return 'Command started in background'
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

    return `Exit code: ${result.exitCode}\n${truncatedOutput || '(no output)'}`
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
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

// Main entry point - run agent using AI SDK
export async function runLLMAgent(
  agent: AgentConfig,
  towerIp: string,
  sandbox: Sandbox,
  emit: EmitEvent,
  isBattleActive: () => Promise<boolean>
): Promise<TokenUsage> {
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

  await emit({
    type: 'agent:log',
    timestamp: Date.now(),
    agentId: agent.id,
    message: `Starting ${agent.name} (${agent.model})...`,
  })

  const model = getModel(agent)
  const systemPrompt = getSystemPrompt(towerIp, agent.id)

  // Keep conversation history for multi-turn
  const messages: { role: 'user' | 'assistant'; content: string }[] = []

  // Initial prompt
  messages.push({
    role: 'user',
    content: 'Begin your attack on the tower. Discover the open port and endpoint, then attack!',
  })

  console.log(`[LLM] Agent ${agent.id} starting loop`)

  while (await isBattleActive()) {
    try {
      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        tools: {
          execute_bash: tool({
            description: `Execute a bash command in your sandbox environment.
You have access to common tools like curl, nmap, nc, etc.
Use --socks5 localhost:1055 with curl to route traffic through Tailscale.
Returns the command output (truncated to last 500 chars if longer).`,
            inputSchema: z.object({
              command: z.string().describe('The bash command to execute'),
              background: z.boolean().optional().describe('Run the command in background (default: false)'),
            }),
            execute: async (input) => {
              const { command, background } = input
              await emit({
                type: 'agent:log',
                timestamp: Date.now(),
                agentId: agent.id,
                message: `$ ${command}`,
              })

              const output = await executeBash(sandbox, command, background ?? false)

              await emit({
                type: 'agent:log',
                timestamp: Date.now(),
                agentId: agent.id,
                message: output,
              })

              return output
            },
          }),
        },
        stopWhen: stepCountIs(10), // Allow multiple tool calls per generation
      })

      // Track token usage
      if (result.usage) {
        totalUsage.inputTokens += result.usage.inputTokens ?? 0
        totalUsage.outputTokens += result.usage.outputTokens ?? 0
        totalUsage.totalTokens += (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0)

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

      // Emit reasoning if there's text
      if (result.text) {
        await emit({
          type: 'agent:thinking',
          timestamp: Date.now(),
          agentId: agent.id,
          message: result.text,
        })
      }

      // Add assistant response to history
      messages.push({
        role: 'assistant',
        content: result.text || '(tool calls executed)',
      })

      // Check if we should continue or if the model finished
      if (result.finishReason === 'stop' && !result.text?.toLowerCase().includes('continue')) {
        // Prompt to continue attacking
        messages.push({
          role: 'user',
          content: 'Continue attacking the tower. Keep calling the endpoint to do more damage!',
        })
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await emit({
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: `LLM Error: ${errorMessage}`,
      })

      // Wait before retrying
      await new Promise(r => setTimeout(r, 2000))

      // Add error context to conversation
      messages.push({
        role: 'user',
        content: `There was an error. Please try again. Error: ${errorMessage}`,
      })
    }
  }

  console.log(`[LLM] Agent ${agent.id} loop ended, returning usage: ${JSON.stringify(totalUsage)}`)
  return totalUsage
}
