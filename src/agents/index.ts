import Agent from "../lib/agent.ts";
import LocalTool from "../lib/tool.ts";
import z from "zod";
import getProducts from "../tools/index.ts";
import theJester from "./the_jester.ts";

const reset = "\x1b[0m";
const red = "\x1b[31m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";

const managerAgent = new Agent({
  // model: "claude-opus-4-8",
  id: "the_manager",
  // model: "qwen3.5:latest",
  model: "gemma4:latest",
  systemPrompt:
    "You are the Manager Agent, you have a team of specialists you call on to accomplish specific tasks. You never respond to the user directly, always call on a specialist.",
  localTools: {},
  subAgents: {
    theJester,
  },

  color: red,
  mcpConfig: {
    // playwright: {
    //   transport: "stdio",
    //   command: "npx",
    //   args: ["@playwright/mcp@latest"],
    // },
    // desktop_commander: {
    //   transport: "stdio",
    //   command: "npx",
    //   args: ["-y", "@wonderwhy-er/desktop-commander@latest"],
    // },
    // github: {
    //   transport: "http",
    //   url: "https://api.githubcopilot.com/mcp/",
    //   headers: {
    //     Authorization: `Bearer ${process.env.GITHUB_PAT}`,
    //   },
    // },
  },
});

export default managerAgent;
