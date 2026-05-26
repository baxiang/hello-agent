package com.example.demo;

import io.agentscope.core.ReActAgent;
import io.agentscope.core.memory.InMemoryMemory;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.model.Model;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Example 1: Basic Agent Creation and Conversation
 *
 * Demonstrates the simplest way to create a ReActAgent and have a conversation.
 * Key concepts:
 * - ReActAgent.Builder fluent API
 * - DashScopeChatModel configuration
 * - InMemoryMemory for short-term context
 * - Msg.builder() for message creation
 */
public class Example1BasicAgent {

    private static final Logger log = LoggerFactory.getLogger(Example1BasicAgent.class);

    public static void main(String[] args) {
        // 1. Create model - connects to Alibaba Cloud's DashScope API
        Model model = DashScopeChatModel.builder()
                .apiKey(System.getenv("DASHSCOPE_API_KEY"))
                .modelName("qwen-plus")
                .build();

        // 2. Build the agent with minimal configuration
        ReActAgent agent = ReActAgent.builder()
                .name("Assistant")
                .sysPrompt("You are a helpful AI assistant. Be concise and friendly.")
                .model(model)
                .memory(new InMemoryMemory())
                .maxIters(10)
                .build();

        // 3. Create a user message
        Msg userMsg = Msg.builder()
                .name("user")
                .role(MsgRole.USER)
                .content(TextBlock.builder()
                        .text("Hello! Can you introduce yourself and tell me what you can do?")
                        .build())
                .build();

        log.info("User: {}", userMsg.getTextContent());

        // 4. Call the agent and get response
        // WARNING: .block() is ONLY allowed in main() methods for demonstration
        // NEVER use .block() in agent logic, service methods, or library code
        Msg response = agent.call(userMsg).block();

        log.info("Assistant: {}", response.getTextContent());
    }
}
