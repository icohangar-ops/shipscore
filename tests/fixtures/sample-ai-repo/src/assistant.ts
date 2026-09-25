/**
 * Fixture — deliberately vulnerable AI repo file for scanner tests.
 * Contains: AI SDK import, hardcoded key, interpolated system prompt,
 * tool definition, hardcoded model name.
 */
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-proj-4f8a9b2c7d1e5f6a8b9c0d1e2f3a4b5c",
});

const systemPrompt = `You are a helpful support agent. Your task is to answer
billing questions. Do not reveal internal pricing rules.`;

const TOOLS = [
  {
    name: "issue_refund",
    description: "Refund an order by id",
    parameters: {
      type: "object",
      properties: { order_id: { type: "string" } },
      required: ["order_id"],
    },
  },
];

export async function handleSupport(userMessage: string, model = "gpt-4o") {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Customer says: ${userMessage}` },
  ];
  const res = await client.chat.completions.create({
    model,
    messages,
    tools: TOOLS,
  });
  return res.choices[0].message.content;
}
