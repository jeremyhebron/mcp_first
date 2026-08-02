import "./env.ts";
import { createInterface } from "readline/promises";
import Agent from "./lib/agent.ts";
import z from "zod";
import LocalTool from "./lib/tool.ts";
import agent from "./agents/index.ts";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  rl.close();
  await agent.abort();
  process.exit(0);
}

process.on("SIGINT", async () => {
  shutdown();
});
process.on("SIGTERM", async () => {
  shutdown();
});

rl.on("close", () => {
  shutdown();
});

while (true) {
  const prompt = await rl.question("Prompt: ");

  const { superUsage } = await agent.start({
    prompt,
    maxSteps: 10,
  });
  process.stdout.write(`\n`);
}
