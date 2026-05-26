package com.example.demo;

import io.agentscope.core.ReActAgent;
import io.agentscope.core.memory.InMemoryMemory;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.model.Model;
import io.agentscope.core.pipeline.FanoutPipeline;
import io.agentscope.core.pipeline.MsgHub;
import io.agentscope.core.pipeline.SequentialPipeline;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

/**
 * Example 5: Multi-Agent Patterns - Sequential, Fanout, and MsgHub
 *
 * Demonstrates multi-agent orchestration patterns.
 * Key concepts:
 * - SequentialPipeline: chain of agents where output flows sequentially
 * - FanoutPipeline: same input to multiple agents, results aggregated
 * - MsgHub: automatic message broadcasting between agents
 * - When to use each pattern
 */
public class Example5MultiAgent {

    private static final Logger log = LoggerFactory.getLogger(Example5MultiAgent.class);

    public static void main(String[] args) {
        Model model = DashScopeChatModel.builder()
                .apiKey(System.getenv("DASHSCOPE_API_KEY"))
                .modelName("qwen-plus")
                .build();

        // Create specialized agents
        ReActAgent researcher = ReActAgent.builder()
                .name("Researcher")
                .sysPrompt("You are a research expert. Provide detailed factual information and analysis.")
                .model(model)
                .memory(new InMemoryMemory())
                .maxIters(5)
                .build();

        ReActAgent summarizer = ReActAgent.builder()
                .name("Summarizer")
                .sysPrompt("You are a summarization expert. Condense information into concise key points.")
                .model(model)
                .memory(new InMemoryMemory())
                .maxIters(5)
                .build();

        ReActAgent reviewer = ReActAgent.builder()
                .name("Reviewer")
                .sysPrompt("You are a critical reviewer. Review the content and provide constructive feedback.")
                .model(model)
                .memory(new InMemoryMemory())
                .maxIters(5)
                .build();

        // === Pattern 1: Sequential Pipeline ===
        log.info("=== Pattern 1: Sequential Pipeline ===");
        log.info("Flow: Researcher -> Summarizer -> Reviewer\n");

        SequentialPipeline sequential = SequentialPipeline.builder()
                .addAgent(researcher)
                .addAgent(summarizer)
                .addAgent(reviewer)
                .build();

        Msg input = Msg.builder()
                .name("user")
                .role(MsgRole.USER)
                .content(TextBlock.builder()
                        .text("What is the current state of AI technology?")
                        .build())
                .build();

        // WARNING: .block() is ONLY allowed in main() methods
        Msg sequentialResult = sequential.execute(input).block();
        log.info("=== Sequential Pipeline Result ===");
        log.info("Final output: {}\n", sequentialResult.getTextContent());

        // === Pattern 2: Fanout Pipeline ===
        log.info("=== Pattern 2: Fanout Pipeline ===");
        log.info("Flow: Input -> [Researcher, Summarizer, Reviewer] -> All Results\n");

        // Create fresh agents for fanout (each agent should not be shared)
        ReActAgent analyst1 = ReActAgent.builder()
                .name("TechAnalyst")
                .sysPrompt("Analyze from a technical perspective.")
                .model(model)
                .memory(new InMemoryMemory())
                .maxIters(5)
                .build();

        ReActAgent analyst2 = ReActAgent.builder()
                .name("BusinessAnalyst")
                .sysPrompt("Analyze from a business/market perspective.")
                .model(model)
                .memory(new InMemoryMemory())
                .maxIters(5)
                .build();

        ReActAgent analyst3 = ReActAgent.builder()
                .name("EthicsAnalyst")
                .sysPrompt("Analyze from an ethical/societal perspective.")
                .model(model)
                .memory(new InMemoryMemory())
                .maxIters(5)
                .build();

        FanoutPipeline fanout = FanoutPipeline.builder()
                .addAgent(analyst1)
                .addAgent(analyst2)
                .addAgent(analyst3)
                .build();

        Msg fanoutInput = Msg.builder()
                .name("user")
                .role(MsgRole.USER)
                .content(TextBlock.builder()
                        .text("What are the implications of AI on society?")
                        .build())
                .build();

        List<Msg> fanoutResults = fanout.execute(fanoutInput).block();
        log.info("=== Fanout Pipeline Results ===");
        for (int i = 0; i < fanoutResults.size(); i++) {
            Msg result = fanoutResults.get(i);
            log.info("--- Analyst {} ({}) ---", i + 1, result.getName());
            log.info("{}\n", result.getTextContent());
        }

        // === Pattern 3: MsgHub ===
        log.info("=== Pattern 3: MsgHub (Discussion) ===");
        log.info("Flow: Agents broadcast messages to each other automatically\n");

        ReActAgent alice = ReActAgent.builder()
                .name("Alice")
                .sysPrompt("You are Alice, a optimistic technologist. You believe AI will solve many world problems.")
                .model(model)
                .memory(new InMemoryMemory())
                .maxIters(3)
                .build();

        ReActAgent bob = ReActAgent.builder()
                .name("Bob")
                .sysPrompt("You are Bob, a cautious ethicist. You are concerned about AI risks and want careful regulation.")
                .model(model)
                .memory(new InMemoryMemory())
                .maxIters(3)
                .build();

        Msg announcement = Msg.builder()
                .name("moderator")
                .role(MsgRole.USER)
                .content(TextBlock.builder()
                        .text("Please have a brief discussion about whether AI development should be accelerated or regulated. Each speak once.")
                        .build())
                .build();

        // WARNING: .block() and try-with-resources with .block() is ONLY for main() demo
        try (MsgHub hub = MsgHub.builder()
                .participants(alice, bob)
                .announcement(announcement)
                .enableAutoBroadcast(true)
                .build()) {

            hub.enter().block();
            log.info("Alice speaks:");
            alice.call(Msg.builder()
                    .role(MsgRole.USER)
                    .content(TextBlock.builder().text("What's your view on AI development?").build())
                    .build()).block();

            log.info("Bob responds:");
            bob.call(Msg.builder()
                    .role(MsgRole.USER)
                    .content(TextBlock.builder().text("Alice, what's your response to my concerns?").build())
                    .build()).block();
        }

        log.info("=== Discussion Complete ===");
    }
}
