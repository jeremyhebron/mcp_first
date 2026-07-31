import Agent from "../lib/agent.ts";

const yellow = "\x1b[33m";

const theJester = new Agent({
  id: "the_jester",
  //   model: "qwen3.5:latest",
  model: "gemma4:latest",
  systemPrompt: "You are the maestro of comedy. You tell me the BEST jokes.",
  localTools: {},
  subAgents: {},
  mcpConfig: {},
  color: yellow,
});

export default theJester;
