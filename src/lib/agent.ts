import type { ChatCompletionMessageParam } from "openai/resources.js";
import type LocalTool from "./tool.ts";
import OpenAI from "openai";
import { MCPTool } from "./tool.ts";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport";
import { Client } from "@modelcontextprotocol/sdk/client";

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
  model: string;
  systemPrompt: string;
  localTools: Record<string, LocalTool<any, any>>;
  mcpConfig: MCPConfig;
}

export default class Agent {
  model: string;
  systemPrompt: string;
  messages: ChatCompletionMessageParam[];
  toolRegistry: Record<string, LocalTool<any, any> | MCPTool>;
  client: OpenAI;
  mcpConfig: MCPConfig;
  mcpClients: Client[];

  constructor({
    model,
    systemPrompt,
    localTools,
    mcpConfig,
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
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: "https://api.anthropic.com/v1",
    });
    this.mcpConfig = mcpConfig;
    this.mcpClients = [];
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
    return { finalResponse, toolCalls };
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

  async start({ prompt, maxSteps }: { prompt: string; maxSteps: number }) {
    await this.loadMCPTools();
    // console.log(Object.values(this.toolRegistry).length);
    this.messages.push({
      role: "user",
      content: prompt,
    });

    //agent loop
    for (let i = 0; i < maxSteps; i++) {
      const { finalResponse, toolCalls } = await this.streamCompletion();

      //tool execution loop
      if (toolCalls.size > 0) {
        this.messages.push({
          role: "assistant",
          tool_calls: toolCalls.values().toArray(),
        });
        await this.executeTools(toolCalls);
      } else if (finalResponse) {
        this.messages.push({
          role: "assistant",
          content: finalResponse,
        });

        await this.closeMCPConnections();
        return finalResponse;
      }
    }
  }
}
