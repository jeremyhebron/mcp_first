import LocalTool from "../lib/tool.ts";
import z from "zod";

const getProducts = new LocalTool({
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
});

export default getProducts;
