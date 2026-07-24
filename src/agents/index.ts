import Agent from "../lib/agent.ts";
import LocalTool from "../lib/tool.ts";
import z from "zod";
import getProducts from "../tools/index.ts";

const agent = new Agent({
  model: "claude-opus-4-8",
  systemPrompt:
    "You are a helpful assistant. You have Access to Playwright for browser control and web search queries, and Github for anything related to Github.",
  localTools: {
    getProducts,
  },
  mcpConfig: {
    playwright: {
      transport: "stdio",
      command: "npx",
      args: ["@playwright/mcp@latest"],
    },

    desktop_commander: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@wonderwhy-er/desktop-commander@latest"],
    },
    github: {
      transport: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_PAT}`,
      },
    },
  },
});

export default agent;
