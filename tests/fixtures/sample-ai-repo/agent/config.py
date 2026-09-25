"""
Fixture — python agent with eval coverage.
Contains: langchain import, crewai-style permission, f-string prompt with
untrusted input, eval framework import.
"""
from langchain.agents import AgentExecutor
from crewai import Agent

researcher = Agent(
    role="Researcher",
    goal="Summarize articles",
    allow_code_execution=True,
    verbose=True,
)

def summarize(article_text: str) -> str:
    prompt = f"""You are a research assistant. Your task is to summarize
the following article for a newsletter. Respond with only the summary.
Article: {article_text}"""
    return AgentExecutor.run(prompt)

# evals exist for this path
from deepeval import assert_test
