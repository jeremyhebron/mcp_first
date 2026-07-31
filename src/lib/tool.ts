import type { Client } from "@modelcontextprotocol/sdk/client";
import type OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources.js";
import { z, type ZodObject } from "zod";
import type { StringValidation } from "zod/v3";

interface LocalTollConstructorArgs<
  InputSchema extends ZodObject,
  OutputSchema extends ZodObject,
> {
  name: string;
  description: string;
  inputZodSchema: InputSchema;
  outputZodSchema: OutputSchema;
  execute: (input: z.infer<InputSchema>) => Promise<z.infer<OutputSchema>>;
}

export default class LocalTool<
  InputSchema extends ZodObject,
  OutputSchema extends ZodObject,
> {
  name: string;
  description: string;
  inputZodSchema: InputSchema;
  outputZodSchema: OutputSchema;
  definition: ChatCompletionTool;
  _execute: (input: z.infer<InputSchema>) => Promise<z.infer<OutputSchema>>;

  constructor({
    name,
    description,
    execute,
    outputZodSchema,
    inputZodSchema,
  }: LocalTollConstructorArgs<InputSchema, OutputSchema>) {
    this.name = name;
    this.description = description;
    this._execute = execute;
    this.inputZodSchema = inputZodSchema;
    this.outputZodSchema = outputZodSchema;
    this.definition = {
      type: "function",
      function: {
        name,
        description,
        parameters: inputZodSchema.toJSONSchema(),
      },
    };
  }
  async execute(
    input: z.infer<InputSchema>,
  ): Promise<z.infer<OutputSchema> | Error> {
    try {
      return await this._execute(input);
    } catch (error) {
      return error as Error;
    }
  }
}

interface MCPToolConstructorArgs {
  name: string;
  description: string;
  mcpClient: Client;
  definition: ChatCompletionTool;
}

export class MCPTool {
  name: string;
  description: string;
  mcpClient: Client;
  definition: ChatCompletionTool;

  constructor({
    name,
    description,
    mcpClient,
    definition,
  }: MCPToolConstructorArgs) {
    this.name = name;
    this.description = description;
    this.mcpClient = mcpClient;
    this.definition = definition;
  }

  async execute(input: any) {
    try {
      return this.mcpClient.callTool({
        name: this.name,
        arguments: input,
      });
    } catch (e) {
      console.error(e);
      return e as Error;
    }
  }
}

// const getProductTool = new LocalTool({
//   name: "get_products",
//   description: "fetches products",
//   inputZodSchema: z.object({
//     query: z.string(),
//   }),
//   outputZodSchema: z.object({
//     result: z.string(),
//   }),
//   async execute(input) {},
// });
