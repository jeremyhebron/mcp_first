import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport";

const stdoutTransport = new StdioClientTransport({
  command: "npx ",
  args: ["@playwright/mcp@latest"],
});

const streamableHttpTransport = new StreamableHTTPClientTransport(
  new URL("https://api.githubcopilot.com/mcp/"),
  {
    requestInit: {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_PAT}`,
      },
    },
  },
);

const mpcClient = new Client({
  name: "my-app",
  version: "1.0.0",
});

await mpcClient.connect(streamableHttpTransport as Transport);

await mpcClient.connect(stdoutTransport);

const { tools } = await mpcClient.listTools();

console.log(tools);
