import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPendingKnowledgeContext,
  consumePendingKnowledgeContext,
  setPendingKnowledgeContext,
} from "./knowledge-base.js";

test("旧 run 的条件清理不会删除新 run 的知识上下文", () => {
  setPendingKnowledgeContext("旧上下文", {
    runId: "run-old",
    conversationId: "conversation-old",
  });
  setPendingKnowledgeContext("新上下文", {
    runId: "run-new",
    conversationId: "conversation-new",
  });

  clearPendingKnowledgeContext({
    runId: "run-old",
    conversationId: "conversation-old",
  });

  assert.equal(consumePendingKnowledgeContext(), "新上下文");
});

test("匹配 owner 的清理会移除知识上下文", () => {
  setPendingKnowledgeContext("上下文", {
    runId: "run-1",
    conversationId: "conversation-1",
  });

  clearPendingKnowledgeContext({
    runId: "run-1",
    conversationId: "conversation-1",
  });

  assert.equal(consumePendingKnowledgeContext(), null);
});
