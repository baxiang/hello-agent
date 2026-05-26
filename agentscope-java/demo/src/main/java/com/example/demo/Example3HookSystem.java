package com.example.demo;

import io.agentscope.core.ReActAgent;
import io.agentscope.core.hook.Hook;
import io.agentscope.core.hook.HookEvent;
import io.agentscope.core.hook.PostActingEvent;
import io.agentscope.core.hook.PreActingEvent;
import io.agentscope.core.hook.PreReasoningEvent;
import io.agentscope.core.hook.ReasoningChunkEvent;
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

import java.time.Duration;

/**
 * Example 3: Hook System - Intercepting Agent Lifecycle
 *
 * Demonstrates how to use hooks to monitor and modify agent execution.
 * Key concepts:
 * - Hook interface with onEvent(T event) method
 * - Priority system (lower value = higher priority)
 * - PreReasoningEvent: intercept before LLM reasoning
 * - PostActingEvent: intercept after tool execution
 * - ReasoningChunkEvent: streaming reasoning output
 * - Modifiable vs notification-only events
 * - Event types: PreCallEvent, PostCallEvent, PreReasoningEvent,
 *   PostReasoningEvent, PreActingEvent, PostActingEvent,
 *   ReasoningChunkEvent, ActingChunkEvent, ErrorEvent
 */
public class Example3HookSystem {

    private static final Logger log = LoggerFactory.getLogger(Example3HookSystem.class);

    public static void main(String[] args) {
        Model model = DashScopeChatModel.builder()
                .apiKey(System.getenv("DASHSCOPE_API_KEY"))
                .modelName("qwen-plus")
                .build();

        Toolkit toolkit = new Toolkit();
        toolkit.registerTool(new WeatherTools());

        // Hook 1: Low priority logging hook (priority 500)
        Hook loggingHook = new Hook() {
            @Override
            public <T extends HookEvent> Mono<T> onEvent(T event) {
                if (event instanceof PreReasoningEvent e) {
                    log.info("[Hook] PreReasoning: Agent is about to reason with model: {}", e.getModelName());
                    return Mono.just(event);
                } else if (event instanceof PreActingEvent e) {
                    log.info("[Hook] PreActing: About to call tool: {}", e.getToolUse().getName());
                    return Mono.just(event);
                } else if (event instanceof PostActingEvent e) {
                    log.info("[Hook] PostActing: Tool {} completed", e.getToolUse().getName());
                    return Mono.just(event);
                } else if (event instanceof ReasoningChunkEvent e) {
                    String text = e.getIncrementalChunk().getTextContent();
                    if (text != null && !text.isEmpty()) {
                        System.out.print(text);
                    }
                    return Mono.just(event);
                }
                return Mono.just(event);
            }

            @Override
            public int priority() {
                return 500; // Low priority for logging
            }
        };

        // Hook 2: High priority validation hook (priority 10)
        Hook validationHook = new Hook() {
            @Override
            public <T extends HookEvent> Mono<T> onEvent(T event) {
                if (event instanceof PreReasoningEvent e) {
                    // Example: inject a hint before reasoning
                    e.appendSystemContent("\nRemember to always use tools when you can get more accurate information.");
                    log.info("[Hook] PreReasoning: Injected tool usage hint into system message");
                    return Mono.just(event);
                } else if (event instanceof PreActingEvent e) {
                    // Example: validate tool call
                    String toolName = e.getToolUse().getName();
                    if (toolName.contains("delete") || toolName.contains("drop")) {
                        log.warn("[Hook] PreActing: Blocking dangerous tool call: {}", toolName);
                        // Could modify or block the tool call here
                    }
                    return Mono.just(event);
                }
                return Mono.just(event);
            }

            @Override
            public int priority() {
                return 10; // High priority - runs before logging hook
            }
        };

        ReActAgent agent = ReActAgent.builder()
                .name("HookDemoAgent")
                .sysPrompt("You are a helpful assistant with weather tools.")
                .model(model)
                .toolkit(toolkit)
                .memory(new InMemoryMemory())
                .hook(validationHook)  // High priority hook first
                .hook(loggingHook)     // Low priority hook second
                .maxIters(10)
                .build();

        Msg userMsg = Msg.builder()
                .name("user")
                .role(MsgRole.USER)
                .content(TextBlock.builder()
                        .text("What's the weather in Beijing and Shanghai?")
                        .build())
                .build();

        log.info("=== User: {} ===", userMsg.getTextContent());
        log.info("=== Assistant (streaming): ===");

        // WARNING: .block() is ONLY allowed in main() methods
        Msg response = agent.call(userMsg).block();

        System.out.println();
        log.info("=== Final Response: {} ===", response.getTextContent());
    }

    public static class WeatherTools {

        @Tool(name = "get_weather", description = "Get current weather for a city")
        public Mono<String> getWeather(
                @ToolParam(name = "city", description = "City name, e.g., 'Beijing'") String city) {
            log.info("[WeatherTool] Getting weather for: {}", city);
            return Mono.delay(Duration.ofMillis(1000))
                    .map(delay -> "Weather in " + city + ": Sunny, 22°C, Light breeze");
        }
    }
}
