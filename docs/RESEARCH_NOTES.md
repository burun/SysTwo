# SysTwo Research Notes

Status: draft  
Date: 2026-06-27

These notes capture positioning references used while shaping SysTwo V0. They are not endorsements or compatibility guarantees.

## Adjacent Categories

SysTwo should be described as complementary to adjacent systems.

| Category | Examples | Difference |
| --- | --- | --- |
| Agent frameworks | LangGraph, AutoGen, Microsoft Agent Framework, CrewAI | They help build agent systems. SysTwo is a drop-in MCP server for bounded coding delegation. |
| Model gateways | OpenRouter, LiteLLM, Portkey | They route model/API calls. SysTwo routes task steps with permissions, worktrees, evidence, and usage. |
| Observability tools | LangSmith, Helicone | They trace and evaluate AI behavior. SysTwo records delegation evidence but does not try to be a full observability platform. |
| Coding agents | Claude Code, OpenCode, OpenHands, Aider | They execute coding tasks. SysTwo orchestrates runner agents behind a controller and enforces delegation boundaries. |

The wedge is not "another coding agent." The wedge is safe, cost-aware delegation across agents.

## References

- MCP standard: https://modelcontextprotocol.io/docs/getting-started/intro
- MCP tools spec: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- LangGraph: https://docs.langchain.com/oss/python/langgraph/overview
- AutoGen: https://microsoft.github.io/autogen/stable/
- Microsoft Agent Framework: https://learn.microsoft.com/en-us/agent-framework/overview/
- CrewAI: https://docs.crewai.com/
- OpenRouter: https://openrouter.ai/docs/quickstart
- LiteLLM: https://docs.litellm.ai/
- Portkey AI Gateway: https://docs.portkey.ai/docs/product/ai-gateway
- Helicone AI Gateway: https://docs.helicone.ai/gateway/overview
- LangSmith observability: https://docs.langchain.com/langsmith/observability
- Claude Code subagents: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Claude Code hooks: https://docs.anthropic.com/en/docs/claude-code/hooks
- Claude Code costs: https://docs.anthropic.com/en/docs/claude-code/costs
- OpenCode: https://opencode.ai/docs/
- OpenHands: https://github.com/OpenHands/openhands
- Aider: https://github.com/Aider-AI/aider
