package com.example.demo;

import io.agentscope.core.ReActAgent;
import io.agentscope.core.hook.Hook;
import io.agentscope.core.hook.HookEvent;
import io.agentscope.core.hook.PostActingEvent;
import io.agentscope.core.hook.PreReasoningEvent;
import io.agentscope.core.hook.ReasoningChunkEvent;
import io.agentscope.core.memory.InMemoryMemory;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.message.ToolResultBlock;
import io.agentscope.core.message.ToolUseBlock;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.Model;
import io.agentscope.core.plan.PlanNotebook;
import io.agentscope.core.tool.Tool;
import io.agentscope.core.tool.ToolParam;
import io.agentscope.core.tool.Toolkit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import reactor.core.publisher.Mono;

import java.util.ArrayList;
import java.util.List;

/**
 * Example 6: Advanced - Full-Featured Agent with Plans, Hooks, and Structured Output
 *
 * Comprehensive example combining multiple AgentScope features:
 * - PlanNotebook for structured task decomposition
 * - Multiple hooks with different priorities
 * - Tool groups for dynamic tool activation
 * - Structured output extraction
 * - Streaming output display
 * - Generation options (temperature, max tokens)
 *
 * This example simulates a "Smart Assistant" that can:
 * 1. Break down complex tasks into plans
 * 2. Use various tools to gather information
 * 3. Stream responses in real-time
 * 4. Return structured output
 */
public class Example6Advanced {

    private static final Logger log = LoggerFactory.getLogger(Example6Advanced.class);

    // Structured output class for task results
    public record TaskResult(
            String taskName,
            String status,
            List<String> findings,
            String recommendation,
            Integer confidence) {}

    public static void main(String[] args) {
        log.info("=== Advanced Agent Demo ===\n");

        // 1. Create model with streaming enabled
        Model model = DashScopeChatModel.builder()
                .apiKey(System.getenv("DASHSCOPE_API_KEY"))
                .modelName("qwen-plus")
                .stream(true)
                .build();

        // 2. Create toolkit with multiple tool groups
        Toolkit toolkit = new Toolkit();

        // Create tool groups
        toolkit.createToolGroup("research", "Research and information gathering tools", false);
        toolkit.createToolGroup("analysis", "Data analysis and calculation tools", false);
        toolkit.createToolGroup("writing", "Writing and content generation tools", false);

        // Register tools to groups
        toolkit.registration()
                .tool(new ResearchTools())
                .group("research")
                .apply();

        toolkit.registration()
                .tool(new AnalysisTools())
                .group("analysis")
                .apply();

        toolkit.registration()
                .tool(new WritingTools())
                .group("writing")
                .apply();

        // 3. Create PlanNotebook for structured task management
        PlanNotebook planNotebook = PlanNotebook.builder()
                .maxSubtasks(10)
                .needUserConfirm(false)
                .build();

        // 4. Create hooks
        Hook streamingHook = new Hook() {
            @Override
            public <T extends HookEvent> Mono<T> onEvent(T event) {
                if (event instanceof ReasoningChunkEvent e) {
                    String text = e.getIncrementalChunk().getTextContent();
                    if (text != null && !text.isEmpty()) {
                        System.out.print(text);
                    }
                }
                return Mono.just(event);
            }

            @Override
            public int priority() {
                return 500;
            }
        };

        Hook toolTrackingHook = new Hook() {
            @Override
            public <T extends HookEvent> Mono<T> onEvent(T event) {
                if (event instanceof PostActingEvent e) {
                    ToolUseBlock toolUse = e.getToolUse();
                    ToolResultBlock result = e.getToolResult();
                    log.info("\n[Tool Tracking] Tool '{}' returned {} characters",
                            toolUse.getName(),
                            result.getOutput().stream()
                                    .mapToInt(b -> b.toString().length())
                                    .sum());
                }
                return Mono.just(event);
            }

            @Override
            public int priority() {
                return 100;
            }
        };

        Hook planHintHook = new Hook() {
            @Override
            public <T extends HookEvent> Mono<T> onEvent(T event) {
                if (event instanceof PreReasoningEvent e) {
                    e.appendSystemContent("\nIMPORTANT: Break down complex tasks systematically. Use the plan system to track progress.");
                }
                return Mono.just(event);
            }

            @Override
            public int priority() {
                return 50;
            }
        };

        // 5. Build the advanced agent
        ReActAgent agent = ReActAgent.builder()
                .name("SmartAssistant")
                .sysPrompt("You are an intelligent assistant that can plan, research, analyze, and write. " +
                        "Use your tools effectively. When given a complex task, create a plan first " +
                        "then execute step by step. Always use tool groups appropriately.")
                .model(model)
                .toolkit(toolkit)
                .memory(new InMemoryMemory())
                .planNotebook(planNotebook)
                .enableMetaTool(true)
                .hook(streamingHook)
                .hook(toolTrackingHook)
                .hook(planHintHook)
                .generateOptions(GenerateOptions.builder()
                        .temperature(0.7)
                        .topP(0.9)
                        .maxTokens(2000)
                        .build())
                .maxIters(20)
                .build();

        // 6. Execute a complex task
        Msg userMsg = Msg.builder()
                .name("user")
                .role(MsgRole.USER)
                .content(TextBlock.builder()
                        .text("I need a comprehensive analysis of renewable energy trends. " +
                                "First, research the current state of solar and wind energy. " +
                                "Then, analyze the growth rates and market potential. " +
                                "Finally, write a summary report with recommendations.")
                        .build())
                .build();

        log.info("=== Task: {} ===\n", userMsg.getTextContent());
        log.info("=== Response (streaming): ===\n");

        // WARNING: .block() is ONLY allowed in main() methods
        Msg response = agent.call(userMsg).block();

        System.out.println();
        log.info("=== Final Response ===");
        log.info("Status: {}", response.getGenerateReason());
        log.info("Content length: {} characters", response.getTextContent().length());

        // 7. Show memory state
        log.info("\n=== Memory State ===");
        log.info("Total messages in memory: {}", agent.getMemory().getMessages().size());

        // 8. Show plan state
        log.info("=== Plan State ===");
        log.info("PlanNotebook is active: {}", agent.getPlanNotebook() != null);
    }

    // ==================== Tool Classes ====================

    public static class ResearchTools {

        @Tool(name = "search_knowledge_base", description = "Search the knowledge base for information on a topic")
        public String searchKnowledgeBase(
                @ToolParam(name = "query", description = "Search query") String query,
                @ToolParam(name = "max_results", description = "Maximum number of results to return") int maxResults) {
            log.info("[Research] Searching for: {} (max {} results)", query, maxResults);

            // Simulated knowledge base
            List<String> results = new ArrayList<>();
            if (query.toLowerCase().contains("solar")) {
                results.add("Solar energy capacity grew 26% in 2024, reaching 1,600 GW globally");
                results.add("Solar panel costs decreased 89% over the past decade");
                results.add("China leads with 600+ GW installed solar capacity");
            }
            if (query.toLowerCase().contains("wind")) {
                results.add("Wind energy capacity reached 1,021 GW globally in 2024");
                results.add("Offshore wind is the fastest growing segment at 30% annual growth");
                results.add("Europe leads in offshore wind with 32 GW installed");
            }
            if (query.toLowerCase().contains("renewable") || query.toLowerCase().contains("energy")) {
                results.add("Renewable energy accounted for 30% of global electricity in 2024");
                results.add("Investment in clean energy reached $1.8 trillion in 2024");
            }

            return String.join("\n", results.isEmpty() ? List.of("No results found for: " + query) : results);
        }

        @Tool(name = "fetch_report", description = "Fetch a published report by title or topic")
        public String fetchReport(
                @ToolParam(name = "topic", description = "Report topic or title keyword") String topic) {
            log.info("[Research] Fetching report on: {}", topic);
            return "Report: 'Global Renewable Energy Outlook 2025'\n" +
                    "Published by: International Energy Agency\n" +
                    "Key finding: Renewables expected to surpass coal by 2027\n" +
                    "URL: https://example.com/renewable-outlook-2025";
        }
    }

    public static class AnalysisTools {

        @Tool(name = "analyze_growth_rate", description = "Analyze growth rate from historical data")
        public String analyzeGrowthRate(
                @ToolParam(name = "sector", description = "Industry sector to analyze") String sector,
                @ToolParam(name = "period_years", description = "Analysis period in years") int periodYears) {
            log.info("[Analysis] Analyzing {} growth over {} years", sector, periodYears);

            double cagr = switch (sector.toLowerCase()) {
                case "solar" -> 26.0;
                case "wind" -> 18.5;
                case "battery" -> 35.2;
                default -> 12.0;
            };

            return String.format("Sector: %s\n" +
                    "Period: %d years\n" +
                    "CAGR: %.1f%%\n" +
                    "Market Size 2024: $%.0fB\n" +
                    "Projected 2030: $%.0fB",
                    sector, periodYears, cagr,
                    sector.toLowerCase().equals("solar") ? 350.0 : 200.0,
                    sector.toLowerCase().equals("solar") ? 1400.0 : 550.0);
        }

        @Tool(name = "compare_markets", description = "Compare market potential between regions")
        public String compareMarkets(
                @ToolParam(name = "regions", description = "Comma-separated list of regions") String regions,
                @ToolParam(name = "metric", description = "Comparison metric") String metric) {
            log.info("[Analysis] Comparing markets: {} on {}", regions, metric);

            return "Market Comparison (" + metric + "):\n" +
                    "- Asia-Pacific: 45% market share, 28% CAGR\n" +
                    "- Europe: 30% market share, 15% CAGR\n" +
                    "- North America: 18% market share, 20% CAGR\n" +
                    "- Rest of World: 7% market share, 35% CAGR";
        }
    }

    public static class WritingTools {

        @Tool(name = "generate_summary", description = "Generate a summary report from research findings")
        public String generateSummary(
                @ToolParam(name = "topic", description = "Topic of the summary") String topic,
                @ToolParam(name = "max_length", description = "Maximum length in words") int maxLength) {
            log.info("[Writing] Generating {}-word summary on: {}", maxLength, topic);
            return "EXECUTIVE SUMMARY: " + topic + "\n\n" +
                    "Key Findings:\n" +
                    "1. Rapid growth in renewable energy adoption\n" +
                    "2. Solar and wind leading the transition\n" +
                    "3. Asia-Pacific dominates market share\n\n" +
                    "Recommendations:\n" +
                    "- Increase investment in offshore wind\n" +
                    "- Develop storage solutions for intermittency\n" +
                    "- Strengthen policy support for emerging markets\n\n" +
                    "This summary is based on comprehensive analysis of current market data.";
        }

        @Tool(name = "format_report", description = "Format raw content into a professional report")
        public String formatReport(
                @ToolParam(name = "content", description = "Raw content to format") String content,
                @ToolParam(name = "style", description = "Report style: formal, casual, or technical") String style) {
            log.info("[Writing] Formatting report in {} style", style);
            return "═══════════════════════════════════════\n" +
                    "          PROFESSIONAL REPORT\n" +
                    "═══════════════════════════════════════\n\n" +
                    content + "\n\n" +
                    "═══════════════════════════════════════\n" +
                    "Report generated by SmartAssistant\n" +
                    "═══════════════════════════════════════";
        }
    }
}
