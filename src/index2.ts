import { createInterface } from "readline/promises";
import Agent from "./lib/agent.ts";
import z from "zod";
import LocalTool from "./lib/tool.ts";
import agent from "./agents/index.ts";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

while (true) {
  const prompt = await rl.question("Prompt: ");

  await agent.start({
    prompt,
    maxSteps: 10,
  });
  process.stdout.write(`\n`);
}
