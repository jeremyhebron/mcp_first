import type { ChatCompletionMessageParam } from "openai/resources.js";
import type LocalTool from "./tool.js";
import OpenAI from "openai";

interface AgentConstructorArgs {
  model: string;
  systemPrompt: string;
  localTools: Record<string, LocalTool<any, any>>;
}

export default class Agent {
  model: string;
  systemPrompt: string;
  messages: ChatCompletionMessageParam[];
  toolRegistry: Record<string, LocalTool<any, any>>;
  client: OpenAI;
  constructor({ model, systemPrompt, localTools }: AgentConstructorArgs) {
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.messages = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];

    this.toolRegistry = localTools;
    this.client = new OpenAI({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: "https://api.anthropic.com/v1",
    });
  }

  //helper functions
  getToolDefinitions() {
    return Object.values(this.toolRegistry).map((tool) => tool.definition);
  }

  getTool(toolName: string) {
    return Object.values(this.toolRegistry).find(
      (tool) => tool.name === toolName,
    );
  }

  async start({ prompt, maxSteps }: { prompt: string; maxSteps: number }) {
    this.messages.push({
      role: "user",
      content: prompt,
    });

    //agent loop
    for (let i = 0; i < maxSteps; i++) {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: this.messages,
        stream: true,
        tools: this.getToolDefinitions(),
      });
      let finalResponse = "";
      const toolCalls = new Map<
        number,
        {
          type: "function";
          index: number;
          id: string;
          function: {
            name: string;
            arguments: string;
          };
        }
      >();

      //parsing/collecting tool calls
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        for (const toolCallDelta of delta?.tool_calls ?? []) {
          const cachedToolCall = toolCalls.get(toolCallDelta.index);

          if (cachedToolCall) {
            cachedToolCall.function.arguments +=
              toolCallDelta.function?.arguments ?? "";
          } else {
            toolCalls.set(toolCallDelta.index, {
              type: "function",
              index: toolCallDelta.index,
              id: toolCallDelta.id ?? "",
              function: {
                name: toolCallDelta.function?.name ?? "",
                arguments: toolCallDelta.function?.arguments ?? "",
              },
            });
          }
        }
        if (delta?.content) {
          process.stdout.write(delta.content);
          finalResponse += delta.content;
        }
      }

      //tool execution loop
      if (toolCalls.size > 0) {
        this.messages.push({
          role: "assistant",
          tool_calls: toolCalls.values().toArray(),
        });
        for (const toolCall of toolCalls.values()) {
          const tool = this.getTool(toolCall.function.name);

          if (!tool) {
            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: `Error: tool with name ${toolCall.function.name} does not exist`,
            });
            continue;
          }

          const parsedArgs = JSON.parse(toolCall.function.arguments);

          process.stdout.write(
            `\nCalling Tool: ${toolCall.function.name}(${toolCall.function.arguments})\n`,
          );

          const result = await tool.execute(parsedArgs);

          if (Error.isError(result)) {
            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: `Tool call resulted in error ${result.message}`,
            });
          } else {
            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            });
          }
        }
      } else if (finalResponse) {
        this.messages.push({
          role: "assistant",
          content: finalResponse,
        });

        return finalResponse;
      }
    }
  }
}
