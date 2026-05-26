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

import java.util.List;
/**
 * Example 4: Structured Output - Type-Safe LLM Responses
 *
 * Demonstrates how to get structured, typed output from agents.
 * Key concepts:
 * - Define POJO classes for structured output schema
 * - Use call(msgs, Class<T>) to request typed output
 * - Extract structured data via msg.getStructuredData(Class<T>)
 * - Self-correcting output parsing
 * - StructuredOutputReminder modes
 */
public class Example4StructuredOutput {

    private static final Logger log = LoggerFactory.getLogger(Example4StructuredOutput.class);

    // Define structured output classes using Java 17 records
    public record ProductInfo(
            String productName,
            String brand,
            Double price,
            List<String> features,
            String category,
            Integer rating) {}

    public record SentimentAnalysis(
            String sentiment,
            Double confidence,
            List<String> keyTopics,
            String summary) {}

    public record ExtractedContact(
            String name,
            String email,
            String phone,
            String company,
            String position) {}

    public static void main(String[] args) {
        Model model = DashScopeChatModel.builder()
                .apiKey(System.getenv("DASHSCOPE_API_KEY"))
                .modelName("qwen-plus")
                .build();

        ReActAgent agent = ReActAgent.builder()
                .name("StructuredAgent")
                .sysPrompt("You are a data extraction assistant. Extract structured information from the given text.")
                .model(model)
                .memory(new InMemoryMemory())
                .maxIters(5)
                .build();

        // Example 1: Product Information Extraction
        log.info("=== Example 1: Product Extraction ===");
        Msg productMsg = Msg.builder()
                .name("user")
                .role(MsgRole.USER)
                .content(TextBlock.builder()
                        .text("I want to buy a MacBook Pro 14-inch with M3 chip, 32GB RAM, 1TB SSD. " +
                                "It costs about $2499 and has great performance for video editing. " +
                                "Apple brand, laptop category, I'd give it 5 stars.")
                        .build())
                .build();

        // WARNING: .block() is ONLY allowed in main() methods
        Msg productResponse = agent.call(productMsg, ProductInfo.class).block();

        if (productResponse.hasStructuredData()) {
            ProductInfo product = productResponse.getStructuredData(ProductInfo.class);
            log.info("Extracted Product: {}", product);
        }

        // Example 2: Sentiment Analysis
        log.info("\n=== Example 2: Sentiment Analysis ===");
        Msg sentimentMsg = Msg.builder()
                .name("user")
                .role(MsgRole.USER)
                .content(TextBlock.builder()
                        .text("This phone is absolutely amazing! The camera quality is outstanding " +
                                "and the battery lasts all day. However, the price is a bit too high " +
                                "for what it offers. Overall, I'm very satisfied with my purchase.")
                        .build())
                .build();

        Msg sentimentResponse = agent.call(sentimentMsg, SentimentAnalysis.class).block();

        if (sentimentResponse.hasStructuredData()) {
            SentimentAnalysis sentiment = sentimentResponse.getStructuredData(SentimentAnalysis.class);
            log.info("Extracted Sentiment: {}", sentiment);
        }

        // Example 3: Contact Extraction
        log.info("\n=== Example 3: Contact Extraction ===");
        Msg contactMsg = Msg.builder()
                .name("user")
                .role(MsgRole.USER)
                .content(TextBlock.builder()
                        .text("Hi, I'm Zhang San, a Senior Software Engineer at Alibaba Group. " +
                                "You can reach me at zhangsan@alibaba.com or call me at +86-138-0000-1234.")
                        .build())
                .build();

        Msg contactResponse = agent.call(contactMsg, ExtractedContact.class).block();

        if (contactResponse.hasStructuredData()) {
            ExtractedContact contact = contactResponse.getStructuredData(ExtractedContact.class);
            log.info("Extracted Contact: {}", contact);
        }
    }
}
