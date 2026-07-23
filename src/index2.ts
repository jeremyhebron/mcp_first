import { createInterface } from "readline/promises";
import Agent from "./lib/agent.ts";
import z from "zod";
import LocalTool from "./lib/tool.ts";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const agent = new Agent({
  model: "claude-opus-4-8",
  systemPrompt: "You are a helpful assistant",
  localTools: {
    getProducts: new LocalTool({
      name: "get_products",
      description: "fetches products from an API",
      inputZodSchema: z.object({
        query: z.enum(["phone", "mascara", "iphone", "samsung"]),
      }),
      outputZodSchema: z.object({
        products: z.array(
          z.object({
            title: z.string(),
            price: z.number(),
          }),
        ),
      }),
      async execute(input) {
        const data =
          (await fetch(`https://dummyjson.com/products/search?q=${input.query}
`).then((res) => res.json())) as {
            products: {
              title: string;
              price: number;
            }[];
          };

        return {
          products: data.products.map((product) => ({
            title: product.title,
            price: product.price,
          })),
        };
      },
    }),
  },
});
while (true) {
  const prompt = await rl.question("Prompt: ");

  await agent.start({
    prompt,
    maxSteps: 10,
  });
  process.stdout.write(`\n`);
}
