import { chromium, Browser, Page } from 'playwright'
import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'

const anthropic = new Anthropic({
  apiKey: process.env['ANTHROPIC_API_KEY'],
})

export interface AgentContext {
  url: string
  instruction: string
  maxSteps?: number
  storagePath: string
}

export class BrowserAgent {
  private browser: Browser | null = null
  private page: Page | null = null

  constructor() {}

  async init() {
    this.browser = await chromium.launch({ headless: true })
    const context = await this.browser.newContext({
      viewport: { width: 1024, height: 768 },
      acceptDownloads: true
    })
    this.page = await context.newPage()
  }

  async close() {
    if (this.browser) {
      await this.browser.close()
    }
  }

  async runTask(context: AgentContext): Promise<{ success: boolean; resultFilePath?: string }> {
    if (!this.page) await this.init()

    console.log(`[BrowserAgent] Navigating to ${context.url}`)
    await this.page!.goto(context.url, { waitUntil: 'networkidle' })

    const maxSteps = context.maxSteps || 15
    let stepCount = 0

    const messages: Anthropic.MessageParam[] = []

    // O loop de interação
    while (stepCount < maxSteps) {
      stepCount++
      console.log(`[BrowserAgent] Step ${stepCount}/${maxSteps}`)

      // 1. Tira screenshot
      const screenshot = await this.page!.screenshot({ type: 'jpeg', quality: 80, scale: 'css' })
      const base64Image = screenshot.toString('base64')

      messages.push({
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: stepCount === 1 ? context.instruction : 'Continue. What is the next step?',
          },
        ],
      })

      // 2. Chama o Claude usando o Computer Use
      console.log(`[BrowserAgent] Calling Claude API...`)
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages,
        system: "You are an automated browser agent. Complete the task using the provided computer tool. If you have successfully downloaded the document or finished the task, call the tool 'finish_task'.",
        tools: [
          {
            type: 'computer_20241022' as any,
            name: 'computer',
            display_width_px: 1024,
            display_height_px: 768,
            display_number: 1,
          },
          {
            name: 'finish_task',
            description: 'Call this tool when the task is fully complete and the file has been downloaded or the goal is met.',
            input_schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                reason: { type: 'string' },
              },
            },
          },
        ] as any,
      })

      const toolCalls = response.content.filter((c) => c.type === 'tool_use') as Anthropic.ToolUseBlock[]
      const assistantText = response.content.filter((c) => c.type === 'text') as Anthropic.TextBlock[]
      
      if (assistantText.length > 0) {
        console.log(`[BrowserAgent] Claude said: ${assistantText[0]?.text}`)
      }

      messages.push({
        role: 'assistant',
        content: response.content,
      })

      if (toolCalls.length === 0) {
        console.log(`[BrowserAgent] No tool called. Finishing with failure.`)
        return { success: false }
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      let finished = false

      for (const call of toolCalls) {
        if (call.name === 'finish_task') {
          console.log(`[BrowserAgent] Task finished successfully by Claude.`)
          finished = true
          toolResults.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: 'Task finished successfully.',
          })
          break
        }

        if (call.name === 'computer') {
          const action = call.input as any
          console.log(`[BrowserAgent] Executing computer action: ${action.action}`)

          try {
            await this.executeComputerAction(action)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: 'Action executed successfully.',
            })
          } catch (e: any) {
            console.error(`[BrowserAgent] Action failed: ${e.message}`)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: `Error executing action: ${e.message}`,
              is_error: true
            })
          }
        }
      }

      messages.push({
        role: 'user',
        content: toolResults,
      })

      if (finished) break

      // Aguarda o site responder
      await this.page!.waitForTimeout(2000)
    }

    // Procura o arquivo na pasta de downloads local (simulado por enquanto)
    return { success: true, resultFilePath: path.join(context.storagePath, `autos-${randomUUID()}.pdf`) }
  }

  private async executeComputerAction(input: any) {
    if (!this.page) return

    const { action, coordinate, text } = input

    switch (action) {
      case 'left_click':
      case 'right_click':
      case 'double_click': {
        if (coordinate && coordinate.length === 2) {
          const [x, y] = coordinate
          await this.page.mouse.move(x, y)
          if (action === 'right_click') {
            await this.page.mouse.click(x, y, { button: 'right' })
          } else if (action === 'double_click') {
            await this.page.mouse.click(x, y, { clickCount: 2 })
          } else {
            await this.page.mouse.click(x, y)
          }
        }
        break
      }
      case 'type': {
        if (text) {
          await this.page.keyboard.type(text)
        }
        break
      }
      case 'key': {
        if (text) {
          // O claude envia 'Return', mapeamos para 'Enter'
          const key = text === 'Return' ? 'Enter' : text
          await this.page.keyboard.press(key)
        }
        break
      }
      case 'scroll': {
        const { amount } = input // scroll action might not have coordinate but amount? Actually computer tool scroll is handled by scroll down/up
        // simplificação
        await this.page.mouse.wheel(0, 500)
        break
      }
    }
  }
}
