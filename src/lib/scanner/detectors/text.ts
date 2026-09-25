/**
 * ShipScore scanner — text detectors for non-TS surfaces:
 * Python AI code, YAML (GitHub workflows, compose, MCP), JSON (MCP configs),
 * and committed .env files. Line-based, deterministic, capped per file.
 */

import type { Severity, Touchpoint } from "../types";

const PY_AI_IMPORT_RE =
  /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/;
const PY_AI_MODULES =
  /(^|\.)(openai|anthropic|langchain[\w_]*|litellm|cohere|mistralai|google\.generativeai|google\.genai|together|groq|ollama|huggingface_hub|transformers|zhipuai|deepseek)/i;

const PY_INSTRUCTION_RE =
  /\b(you are (?:a|an|the)|your (?:task|job|role)|respond (?:in|with|only)|do not (?:reveal|share)|act as|step[- ]by[- ]step)\b/i;

const PY_UNTRUSTED_RE =
  /\b(user_?\w*|input_?\w*|\w*article\w*|\w*transcript\w*|\w*document\w*|\w*webpage\w*|\w*content|\w*payload|query|request|body|comment|review|ticket|email|search_?\w*)\b/i;

const MODEL_NAME_RE =
  /\b(gpt-4o(?:-mini)?|gpt-4(?:\.1|o)?[\w.-]*|gpt-3\.5-turbo|o[134](?:-preview|-mini)?|claude-[\w.-]+|gemini-[\w.-]+|llama-?3[\w.-]*|mistral-[\w-]+|glm-4[\w-]*|deepseek-[\w-]+|command-r(?:-plus)?)\b/i;

const SECRET_VALUE_RE = /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/;
const PLACEHOLDER_RE =
  /(your[-_]?key|xxx|changeme|<[^>]+>|\$\{|process\.env|placeholder|example|redacted|dummy|\{\{|%s)/i;

function mk(
  file: string,
  lineNo: number,
  snippet: string,
  kind: Touchpoint["kind"],
  category: Touchpoint["category"],
  severity: Severity,
  detail: string,
  framework?: string,
): Touchpoint {
  return {
    kind,
    category,
    file,
    line: lineNo,
    column: 1,
    snippet: snippet.trim().slice(0, 200),
    detail,
    severity,
    framework,
  };
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

export function scanPython(relPath: string, content: string, out: Touchpoint[]): void {
  const lines = content.split("\n");
  let promptCap = 4;
  let llmCap = 4;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // AI SDK imports / client instantiation
    if (llmCap > 0) {
      const imp = line.match(PY_AI_IMPORT_RE);
      const mod = imp ? (imp[1] ?? imp[2] ?? "") : "";
      if (mod && PY_AI_MODULES.test(mod)) {
        out.push(
          mk(
            relPath,
            lineNo,
            line,
            "llm-call",
            "run",
            "info",
            `AI SDK import ("${mod}") — LLM code path lives here`,
            mod.split(".")[0],
          ),
        );
        llmCap--;
        continue;
      }
      if (/\b(OpenAI|Anthropic|ChatOpenAI|Cohere|Groq)\s*\(/.test(line)) {
        out.push(
          mk(relPath, lineNo, line, "llm-call", "run", "info", "LLM client instantiation"),
        );
        llmCap--;
        continue;
      }
    }

    // prompts: triple-quoted or f-strings with instruction text
    if (promptCap > 0 && PY_INSTRUCTION_RE.test(line) && /("""|'''|f"|f'|")/.test(line)) {
      out.push(
        mk(
          relPath,
          lineNo,
          line,
          "prompt",
          "design",
          "low",
          "Instruction-shaped string — natural-language behavior embedded in source",
        ),
      );
      promptCap--;

      // f-string with untrusted var in the following ~3 lines → injection
      const window = lines.slice(i, i + 3).join("\n");
      if (/f["']{1,3}/.test(window) && PY_UNTRUSTED_RE.test(window)) {
        out.push(
          mk(
            relPath,
            lineNo,
            line,
            "injection",
            "secure",
            "high",
            "Untrusted input interpolated into a prompt f-string — injection surface",
          ),
        );
      }
      continue;
    }

    // dangerous agent permissions
    if (/(allowed_tools|dangerously_allow\w*|allow_code_execution)\s*=\s*(True|\[)/.test(line)) {
      out.push(
        mk(
          relPath,
          lineNo,
          line,
          "agent-permission",
          "secure",
          "medium",
          "Broad agent permission enabled — least-privilege tools instead",
        ),
      );
      continue;
    }

    // secrets
    if (SECRET_VALUE_RE.test(line) && !PLACEHOLDER_RE.test(line)) {
      out.push(
        mk(
          relPath,
          lineNo,
          line,
          "secret",
          "secure",
          "critical",
          "Credential-shaped literal committed in source — rotate and move to a secret manager",
        ),
      );
      continue;
    }

    // hardcoded models
    const model = line.match(/["']([^"']{3,64})["']/);
    if (model && MODEL_NAME_RE.test(model[1]) && !PLACEHOLDER_RE.test(line)) {
      out.push(
        mk(
          relPath,
          lineNo,
          line,
          "model-ref",
          "design",
          "low",
          `Hardcoded model name ("${model[1]}") — model ids should be config, not code`,
        ),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// YAML (workflows / compose / MCP)
// ---------------------------------------------------------------------------

export function scanYaml(relPath: string, content: string, out: Touchpoint[]): void {
  const lines = content.split("\n");
  const isWorkflow = relPath.startsWith(".github/workflows/");
  let permFlagged = false;
  let aiFlagged = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (isWorkflow && !permFlagged && /permissions\s*:\s*(write-all|writeall)/i.test(line)) {
      out.push(
        mk(
          relPath,
          lineNo,
          line,
          "agent-permission",
          "secure",
          "high",
          'Workflow grants "write-all" — scope permissions per job instead',
        ),
      );
      permFlagged = true;
    }

    if (!aiFlagged && /(mcpServers|modelcontextprotocol)/i.test(line)) {
      out.push(
        mk(
          relPath,
          lineNo,
          line,
          "mcp-config",
          "design",
          "info",
          "MCP server configuration — every server is third-party tool surface",
        ),
      );
      aiFlagged = true;
    }

    if (
      !aiFlagged &&
      /(OPENAI|ANTHROPIC|GEMINI|GOOGLE|COHERE|MISTRAL|DEEPSEEK|GROQ|ZHIPU)[_-]?API[_-]?KEY\s*:/i.test(line)
    ) {
      out.push(
        mk(
          relPath,
          lineNo,
          line,
          "llm-call",
          "run",
          "info",
          "LLM vendor credential wired into config — AI runtime path",
        ),
      );
      aiFlagged = true;
    }

    if (SECRET_VALUE_RE.test(line) && !PLACEHOLDER_RE.test(line)) {
      out.push(
        mk(
          relPath,
          lineNo,
          line,
          "secret",
          "secure",
          "critical",
          "Credential-shaped literal committed in config — rotate and move to secrets",
        ),
      );
      break; // one secret hit per yaml file is enough
    }
  }
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export function scanJson(relPath: string, content: string, out: Touchpoint[]): void {
  if (/["']?mcpServers["']?\s*:/.test(content)) {
    const lineNo = content.split("\n").findIndex((l) => /mcpServers/i.test(l)) + 1;
    out.push(
      mk(
        relPath,
        Math.max(1, lineNo),
        "mcpServers: { ... }",
        "mcp-config",
        "design",
        "info",
        "MCP server configuration — every server is third-party tool surface",
      ),
    );
  }

  // committed secrets in JSON
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SECRET_VALUE_RE.test(line) && !PLACEHOLDER_RE.test(line)) {
      out.push(
        mk(
          relPath,
          i + 1,
          line,
          "secret",
          "secure",
          "critical",
          "Credential-shaped literal committed in JSON — rotate and move to secrets",
        ),
      );
      break;
    }
    if (/(OPENAI|ANTHROPIC|GEMINI|COHERE|MISTRAL|DEEPSEEK|GROQ|ZHIPU)[_-]?API[_-]?KEY/i.test(line)) {
      out.push(
        mk(relPath, i + 1, line, "llm-call", "run", "info", "LLM vendor credential in JSON config"),
      );
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// .env files
// ---------------------------------------------------------------------------

export function scanEnvFile(relPath: string, content: string, out: Touchpoint[]): void {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (
      /(API[_-]?KEY|SECRET|TOKEN|PASSWORD)\s*=\s*\S+/i.test(line) &&
      !PLACEHOLDER_RE.test(line) &&
      SECRET_VALUE_RE.test(line)
    ) {
      out.push(
        mk(
          relPath,
          i + 1,
          line.split("=")[0] + "= <redacted>",
          "secret",
          "secure",
          "critical",
          "Committed .env value looks like a live credential — verify it is not git-tracked, then rotate",
        ),
      );
      break; // one hit per env file is enough
    }
  }
}
