package com.example.demo;

import io.agentscope.core.ReActAgent;
import io.agentscope.core.memory.InMemoryMemory;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.model.Model;
import io.agentscope.core.tool.Tool;
import io.agentscope.core.tool.ToolParam;
import io.agentscope.core.tool.Toolkit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import reactor.core.publisher.Mono;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;
import net.objecthunter.exp4j.ExpressionBuilder;

/**
 * Example 2: Tool Calling - Synchronous and Asynchronous Tools
 *
 * Demonstrates how to define and register tools for an agent.
 * Key concepts:
 * - @Tool annotation with name and description
 * - @ToolParam with name = "x", description = "y" format
 * - Toolkit registration via registerTool()
 * - Synchronous tools returning String
 * - Asynchronous tools returning Mono<String>
 * - ToolEmitter for streaming progress (advanced)
 */
public class Example2ToolCalling {

    private static final Logger log = LoggerFactory.getLogger(Example2ToolCalling.class);

    public static void main(String[] args) {
        // 1. Create model
        Model model = DashScopeChatModel.builder()
                .apiKey(System.getenv("DASHSCOPE_API_KEY"))
                .modelName("qwen-plus")
                .build();

        // 2. Create toolkit and register tools
        Toolkit toolkit = new Toolkit();
        toolkit.registerTool(new TimeTools());
        toolkit.registerTool(new CalculatorTools());
        toolkit.registerTool(new DataTools());

        // 3. Build agent with toolkit
        ReActAgent agent = ReActAgent.builder()
                .name("ToolAgent")
                .sysPrompt("You are a helpful assistant with access to various tools. Use tools when appropriate.")
                .model(model)
                .toolkit(toolkit)
                .memory(new InMemoryMemory())
                .maxIters(15)
                .build();

        // 4. Test multi-tool scenario
        Msg userMsg = Msg.builder()
                .name("user")
                .role(MsgRole.USER)
                .content(TextBlock.builder()
                        .text("What time is it now? Also, calculate 25 * 48 and tell me the result.")
                        .build())
                .build();

        log.info("User: {}", userMsg.getTextContent());

        // WARNING: .block() is ONLY allowed in main() methods
        Msg response = agent.call(userMsg).block();

        log.info("Assistant: {}", response.getTextContent());
        log.info("Generate reason: {}", response.getGenerateReason());
    }

    /**
     * Synchronous tool example - returns String directly
     */
    public static class TimeTools {

        private static final DateTimeFormatter FORMATTER =
                DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

        @Tool(name = "get_current_time", description = "Get the current date and time")
        public String getCurrentTime() {
            LocalDateTime now = LocalDateTime.now();
            String formatted = now.format(FORMATTER);
            log.info("[Tool] getCurrentTime called, returning: {}", formatted);
            return "Current time: " + formatted;
        }

        @Tool(name = "format_timestamp", description = "Format a timestamp to human-readable date")
        public String formatTimestamp(
                @ToolParam(name = "timestamp", description = "Unix timestamp in milliseconds") long timestamp) {
            LocalDateTime dateTime = LocalDateTime.ofInstant(
                    java.time.Instant.ofEpochMilli(timestamp),
                    java.time.ZoneId.systemDefault());
            String formatted = dateTime.format(FORMATTER);
            log.info("[Tool] formatTimestamp called with: {}, returning: {}", timestamp, formatted);
            return "Formatted date: " + formatted;
        }
    }

    /**
     * Calculator tool example - demonstrates multiple methods
     */
    public static class CalculatorTools {

        @Tool(name = "calculate", description = "Perform a basic arithmetic calculation")
        public String calculate(
                @ToolParam(name = "expression", description = "Mathematical expression, e.g., '2 + 3 * 4'")
                String expression) {
            log.info("[Tool] calculate called with expression: {}", expression);
            try {
                double result = new ExpressionBuilder(expression).build().evaluate();
                return "Result of " + expression + " = " + result;
            } catch (Exception e) {
                return "Error evaluating expression: " + e.getMessage();
            }
        }

        @Tool(name = "factorial", description = "Calculate the factorial of a number")
        public String factorial(
                @ToolParam(name = "n", description = "The number to calculate factorial for") int n) {
            log.info("[Tool] factorial called with n: {}", n);
            if (n < 0) {
                return "Error: Factorial is not defined for negative numbers";
            }
            long result = 1;
            for (int i = 2; i <= n; i++) {
                result *= i;
            }
            return n + "! = " + result;
        }
    }

    /**
     * Data tool example - demonstrates async tool returning Mono<String>
     */
    public static class DataTools {

        private static final Map<String, String> MOCK_DB = new HashMap<>();
        static {
            MOCK_DB.put("alice", "Alice is a software engineer at Alibaba, age 28");
            MOCK_DB.put("bob", "Bob is a data scientist, age 32");
            MOCK_DB.put("charlie", "Charlie is a product manager, age 30");
        }

        @Tool(name = "query_user_profile", description = "Query user profile information by name")
        public Mono<String> queryUserProfile(
                @ToolParam(name = "username", description = "The username to look up") String username) {
            log.info("[Tool] queryUserProfile called with username: {}", username);
            // Simulate async database lookup with delay
            return Mono.delay(java.time.Duration.ofMillis(500))
                    .map(delay -> {
                        String profile = MOCK_DB.get(username.toLowerCase());
                        if (profile != null) {
                            return "Found profile: " + profile;
                        }
                        return "User '" + username + "' not found in database";
                    });
        }
    }
}
