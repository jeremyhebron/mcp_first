import type { ChatCompletionMessageParam } from "openai/resources.js";
import LocalTool from "./tool.ts";
import OpenAI from "openai";
import { MCPTool } from "./tool.ts";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport";
import { Client } from "@modelcontextprotocol/sdk/client";
import z from "zod";
import type { CompletionUsage } from "openai/resources";
import { Usage } from "openai/resources/admin/organization.js";

type MCPStdioConfig = {
  transport: "stdio";
  command: string;
  args: string[];
};

type MCPStreamableHTTPConfig = {
  transport: "http";
  url: string;
  headers: object;
};

type MCPConfig = Record<string, MCPStdioConfig | MCPStreamableHTTPConfig>;

interface AgentConstructorArgs {
  id: string;
  model: string;
  systemPrompt: string;
  localTools: Record<string, LocalTool<any, any>>;
  mcpConfig: MCPConfig;
  subAgents: Record<string, Agent>;
  color: string;
}

export default class Agent {
  id: string;
  model: string;
  systemPrompt: string;
  messages: ChatCompletionMessageParam[];
  toolRegistry: Record<string, LocalTool<any, any> | MCPTool>;
  client: OpenAI;
  mcpConfig: MCPConfig;
  mcpClients: Client[];
  subAgents: Record<string, Agent>;
  color: string;
  abortController: AbortController;

  constructor({
    model,
    systemPrompt,
    localTools,
    mcpConfig,
    subAgents,
    id,
    color,
  }: AgentConstructorArgs) {
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
      // apiKey: process.env.ANTHROPIC_API_KEY,
      apiKey: "no key",
      // baseURL: "https://api.anthropic.com/v1",
      baseURL: "http://localhost:11434/v1",
    });
    this.mcpConfig = mcpConfig;
    this.mcpClients = [];
    this.id = id;
    this.subAgents = subAgents;
    this.color = color;
    this.abortController = new AbortController();

    const agentIds = Object.values(subAgents).map((subAgent) => subAgent.id);

    let description = "Launches a subagent. The subAgents are as follows: \n";

    for (const subAgent of Object.values(subAgents)) {
      description += `ID: ${subAgent.id}\nRole: ${subAgent.systemPrompt.slice(0, 100)}`;
    }

    const launchSubAgent = new LocalTool({
      name: "Launch_subagent",
      description: "Launches a subagent",
      inputZodSchema: z.object({
        prompt: z.string(),
        agentId: z.enum(agentIds),
      }),
      outputZodSchema: z.object({
        finalResponse: z.string(),
        superUsage: z.object({
          prompt_tokens: z.number(),
          completion_tokens: z.number(),
          total_tokens: z.number(),
        }),
      }),

      execute: async (input) => {
        const subAgent = this.getSubAgent(input.agentId);

        if (!subAgent) {
          throw new Error(`SubAgent with IDL ${input.agentId} does not exist`);
        }

        //step 2: invoke the agent loop and return the final response

        const { finalResponse, superUsage } = await subAgent.start({
          prompt: input.prompt,
          maxSteps: 10,
          isSubAgent: true,
        });

        return { finalResponse, superUsage };
      },
    });
    if (Object.values(subAgents).length > 0) {
      this.toolRegistry[launchSubAgent.name] = launchSubAgent;
    }
  }

  async abort() {
    this.abortController.abort();
    await this.closeMCPConnections();
  }

  get aborted() {
    return this.abortController.signal.aborted;
  }

  getSubAgent(subAgentID: string) {
    return Object.values(this.subAgents).find(
      (subAgent) => subAgentID === subAgent.id,
    );
  }

  async closeMCPConnections() {
    // for (const client of this.mcpClients) {
    //   await client.close();
    // }

    await Promise.all(
      this.mcpClients.map(async (client) => {
        client.close();
      }),
    );

    this.mcpClients = [];
  }

  resolveMCPTransport(config: MCPStdioConfig | MCPStreamableHTTPConfig) {
    //resolving transport type of the mcp server
    let transport: StdioClientTransport | StreamableHTTPClientTransport;

    if (config.transport === "stdio") {
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
      });
    } else if (config.transport === "http") {
      const url = new URL(config.url);

      transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: config.headers,
        },
      });
    } else {
      throw new Error("Incorrect MCP config");
    }
    return transport;
  }

  async loadMCPTools() {
    const mcpConfigs = Object.entries(this.mcpConfig);

    for (const [serverName, config] of mcpConfigs) {
      const transport = this.resolveMCPTransport(config);
      const mcpClient = new Client({
        name: "my-app",
        version: "1.0.0",
      });

      await mcpClient.connect(transport as Transport);

      const { tools } = await mcpClient.listTools();

      for (const tool of tools) {
        const mcpTool = new MCPTool({
          name: tool.name,
          mcpClient,
          description: tool.description ?? "",
          definition: {
            type: "function",
            function: {
              name: tool.name,
              description: tool.description ?? "",
              parameters: tool.inputSchema,
            },
          },
        });
        this.toolRegistry[mcpTool.name] = mcpTool;
      }

      this.mcpClients.push(mcpClient);
    }
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

  async streamCompletion() {
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: this.messages,
        stream: true,
        tools: this.getToolDefinitions(),
        reasoning_effort: "low",
        stream_options: {
          include_usage: true,
        },
      },
      {
        signal: this.abortController.signal,
      },
    );
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

    const reset = "\x1b[0m";
    const lightGray = "\x1b[37m";
    const green = "\x1b[32m";

    type DeltaWithReasoning =
      OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
        reasoning: string;
      };

    let agentHeaderLogged = false;

    let isReasoning = false;

    let streamUsage: CompletionUsage = {
      total_tokens: 0,
      completion_tokens: 0,
      prompt_tokens: 0,
    };

    const startTime = performance.now();
    let firstTokenTime: number | null = null;
    //parsing/collecting tool calls
    for await (const chunk of stream) {
      if (chunk.usage) {
        streamUsage = chunk.usage;
      }
      if (!agentHeaderLogged) {
        process.stdout.write(this.color + `\n${this.id}: \n` + reset);
        agentHeaderLogged = true;
      }
      const delta = chunk.choices[0]?.delta as DeltaWithReasoning;

      const deltaContainsTokens =
        delta?.content || delta?.reasoning || delta?.tool_calls;

      if (firstTokenTime === null && deltaContainsTokens) {
        firstTokenTime = performance.now();
      }

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

      if (!delta?.reasoning) {
        if (isReasoning) {
          process.stdout.write("\nDone Thinking! \n");
          isReasoning = false;
        }
      }

      if (delta?.reasoning) {
        if (!isReasoning) {
          process.stdout.write("\nThinking...\n");
          isReasoning = true;
        }
        process.stdout.write(green + delta.reasoning + reset);
      }
      if (delta?.content) {
        process.stdout.write(delta.content);
        finalResponse += delta.content;
      }
    }

    const endTime = performance.now();
    const ttftMs = (firstTokenTime ?? endTime) - startTime;
    const genSeconds = (endTime - (firstTokenTime ?? startTime)) / 1000;
    const tokensPerSecond =
      genSeconds > 0 ? streamUsage.completion_tokens / genSeconds : 0;
    return { finalResponse, toolCalls, streamUsage, ttftMs, tokensPerSecond };
  }

  async executeTools(
    toolCalls: Map<
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
    >,
    superUsage: CompletionUsage,
  ) {
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
      if (tool.name === "launch_subagent" && result.superUsage) {
        superUsage.prompt_tokens += result.superUsage.prompt_tokens;
        superUsage.completion_tokens += result.superUsage.completion_tokens;
        superUsage.total_tokens += result.superUsage.total_tokens;
      }

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
  }

  async start({
    prompt,
    maxSteps,
    isSubAgent = false,
  }: {
    prompt: string;
    maxSteps: number;
    isSubAgent?: boolean;
  }) {
    this.abortController = new AbortController();
    const startTime = performance.now();
    await this.loadMCPTools();
    // console.log(Object.values(this.toolRegistry).length);
    this.messages.push({
      role: "user",
      content: prompt,
    });

    let superUsage: CompletionUsage = {
      completion_tokens: 0,
      prompt_tokens: 0,
      total_tokens: 0,
    };

    const abortedReturnPayload = {
      finalResponse: "User Aborted",
      superUsage: {
        completion_tokens: 0,
        prompt_tokens: 0,
        total_tokens: 0,
      },
    };
    //agent loop
    for (let i = 0; i < maxSteps; i++) {
      if (this.aborted) {
        return abortedReturnPayload;
      }

      const {
        finalResponse,
        toolCalls,
        streamUsage: streamUsage,
        tokensPerSecond,
        ttftMs,
      } = await this.streamCompletion();

      if (this.aborted) {
        return abortedReturnPayload;
      }

      superUsage.prompt_tokens += streamUsage.prompt_tokens;
      superUsage.completion_tokens += streamUsage.completion_tokens;
      superUsage.total_tokens += streamUsage.total_tokens;

      //tool execution loop
      if (toolCalls.size > 0) {
        this.messages.push({
          role: "assistant",
          tool_calls: toolCalls.values().toArray(),
        });
        await this.executeTools(toolCalls, superUsage);
      } else if (finalResponse) {
        this.messages.push({
          role: "assistant",
          content: finalResponse,
        });

        await this.closeMCPConnections();
        if (!isSubAgent) {
          process.stdout.write("\n");
          console.table({
            ...superUsage,
            tokensPerSecond,
            ttftMs,
          });
          const end = performance.now();
          const duration = Math.round(end - startTime) / 1000;
          console.log(`Total time: ${duration} s`);
        }

        return {
          finalResponse,
          superUsage,
        };
      }
    }

    throw new Error(`Max steps of ${maxSteps} exceeded.`);
  }
}
