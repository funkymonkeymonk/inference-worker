import assert from "node:assert/strict";
import test from "node:test";
import { chatCompletionsUrl, parseSseData } from "./execute-inference.js";

test("builds the chat completions URL from an OpenAI-compatible base URL", () => {
  assert.equal(chatCompletionsUrl("http://127.0.0.1:8081/v1"), "http://127.0.0.1:8081/v1/chat/completions");
  assert.equal(chatCompletionsUrl("http://127.0.0.1:8081/v1/"), "http://127.0.0.1:8081/v1/chat/completions");
});

test("parses streamed text and usage without retaining chunks", () => {
  assert.deepEqual(parseSseData('{"choices":[{"delta":{"content":"hello"}}]}'), { text: "hello" });
  assert.deepEqual(parseSseData('{"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}'), {
    usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
  });
  assert.equal(parseSseData("[DONE]"), null);
});
