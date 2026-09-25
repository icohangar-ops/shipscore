/**
 * ShipScore scanner — AST detectors for JS/TS via ts-morph.
 *
 * Every detector is deterministic and explainable: each finding carries the
 * file, line, snippet, and a one-line reason. Regex literals are used for
 * pattern matching (NOT string literals) so the scanner never flags itself.
 */

import {
  Node,
  Project,
  SourceFile,
  SyntaxKind,
  type CallExpression,
  type Node as TsNode,
  type ObjectLiteralExpression,
  type PropertyAssignment,
} from "ts-morph";
import type { Severity, Touchpoint, TouchpointKind } from "../types";

// ---------------------------------------------------------------------------
// Framework signatures
// ---------------------------------------------------------------------------

/** import module specifiers that indicate an AI SDK */
const AI_IMPORT_RE =
  /(^|[@/])(openai|anthropic|ai|@ai-sdk[/.][\w-]+|langchain[\w/@-]*|z-ai-web-dev-sdk|@google[/.]generative-ai|@google-cloud[/.]vertexai|cohere-ai|mistral(?:ai)?|ollama|@huggingface[/.]inference|groq-sdk|deepseek|zhipu(?:ai)?|@zhipu(?:ai)?[/.][\w-]+|together(?:ai)?|openrouter(?:ai)?|@aws-sdk[/.]client-bedrock-runtime)/i;

/** explicit AI vendor endpoints called via fetch/axios */
const AI_ENDPOINT_RE =
  /(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.cohere\.ai|api\.deepseek\.com|openrouter\.ai|open\.bigmodel\.cn|api\.groq\.com|api\.together\.xyz|api\.mistral\.ai|api\.inference\.ai\.azure\.com)/i;

/** known LLM completion-style method chains */
const AI_METHOD_RE =
  /(\.chat\.completions\.create|\.messages\.create|\.responses\.create|\.completions\.create|\.embeddings\.create|\.generateContent|\.chat\.create\b)/;

/** model-name string literals (hardcoded models are a design smell) */
const MODEL_NAME_RE =
  /\b(gpt-4o(?:-mini|-audio|-realtime)?|gpt-4(?:\.1)?(?:-turbo|-mini)?|gpt-3\.5-turbo|o[134](?:-preview|-mini)?|claude-(?:3|4|sonnet|opus|haiku|instant)[\w.-]*|gemini-[1-9][\w.-]*|llama-?3[\w.-]*|mistral-(?:large|small|medium|codestral)[\w-]*|glm-4[\w-]*|deepseek-(?:chat|coder|reasoner|ai)[\w-]*|davinci(?:-\d{3})?|text-embedding-3(?:-small|-large)?|command-r(?:-plus)?)\b/i;

/** instruction-shaped text that makes a literal a prompt */
const PROMPT_PHRASE_RE =
  /\b(you are (?:a|an|the)|your (?:task|job|goal|role)|respond (?:in|with|only)|answer (?:in|with)|follow(?:ing)? (?:instructions|rules)|do not (?:reveal|mention|use|share)|never (?:reveal|share)|act as|step[- ]by[- ]step|output (?:format|json|only))\b/i;

/** identifier names that commonly carry untrusted, external input */
const UNTRUSTED_VAR_RE =
  /\b(user(?:input|input|msg|message|message|query|prompt|text|content|email|comment|review|ticket|issue|search|request|body|param|data)s?|input(?:s|text|value|message|query)?|query(?:text|string)?|req(?:uest)?\.(?:body|query|params)|message(?:content|body|text)?|content|body|payload|article|webpage|webpage|html|email|comment(?:s)?|review(?:s)?|search(?:term|query)?|transcript)\b/i;

/** keys that grant an agent broad or dangerous capabilities */
const DANGEROUS_PERM_KEY_RE =
  /^(allowed[_-]?tools|allowedtools|dangerously[_-]?allow[a-z_]*|auto[_-]?approve[a-z_]*|full[_-]?access|allow[_-]?code[_-]?execution|allow[_-]?delegation|sudo|admin[_-]?tools)$/i;

const PLACEHOLDER_VALUE_RE = /(your[-_]?key|xxx|changeme|<[^>]+>|\$\{|process\.env|placeholder|example|redacted|dummy)/i;

const TELEMETRY_IMPORT_RE =
  /(opentelemetry|@otel|datadog|sentry|prometheus|newrelic|pino|winston|bunyan|laravel-telemetry)/i;

// ---------------------------------------------------------------------------
// Detection caps — keep reports readable on big repos
// ---------------------------------------------------------------------------

const CAPS: Record<string, number> = {
  prompt: 6,
  "model-ref": 5,
  injection: 8,
  secret: 5,
  "tool-definition": 5,
  "agent-permission": 5,
  "llm-call": 8,
  eval: 2,
  "runtime-guard": 2,
  "mcp-config": 2,
};

const perFileCount = new Map<string, number>();
function underCap(kind: TouchpointKind): boolean {
  const cap = CAPS[kind] ?? 4;
  const n = perFileCount.get(kind) ?? 0;
  if (n >= cap) return false;
  perFileCount.set(kind, n + 1);
  return true;
}
function resetCaps(): void {
  perFileCount.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lineOf(sf: SourceFile, pos: number): { line: number; column: number } {
  const { line, column } = sf.getLineAndColumnAtPos(pos);
  return { line, column };
}

function snippetOf(sf: SourceFile, pos: number): string {
  const { line } = sf.getLineAndColumnAtPos(pos);
  // ⚠ getFullText(), not getText(): getText() drops leading comment trivia,
  // which shifts every line-derived snippet (positions/lines are full-text based)
  const raw = (sf.getFullText().split("\n")[line - 1] ?? "").trim();
  return raw.length > 200 ? `${raw.slice(0, 197)}...` : raw;
}

function push(
  out: Touchpoint[],
  sf: SourceFile,
  pos: number,
  kind: TouchpointKind,
  category: Touchpoint["category"],
  severity: Severity,
  detail: string,
  framework?: string,
): void {
  if (!underCap(kind)) return;
  const { line, column } = lineOf(sf, pos);
  out.push({
    kind,
    category,
    file: "",
    line,
    column,
    snippet: snippetOf(sf, pos),
    detail,
    severity,
    framework,
  });
}

function objectHasJsonSchemaShape(obj: ObjectLiteralExpression): boolean {
  const keys = new Set(
    obj
      .getProperties()
      .map((p) => (Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p) ? p.getName() : ""))
      .filter(Boolean),
  );
  const hasParams = keys.has("parameters") || keys.has("input_schema") || keys.has("parameters");
  const hasDesc = keys.has("description");
  const hasName = keys.has("name");
  return hasParams && (hasName || hasDesc);
}

function getPropertyName(p: PropertyAssignment): string {
  try {
    return p.getName();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

function detectImports(sf: SourceFile, out: Touchpoint[]): Set<string> {
  const found = new Set<string>();
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    const m = spec.match(AI_IMPORT_RE);
    if (m) {
      const framework = spec.includes("z-ai-web-dev-sdk")
        ? "z-ai-web-dev-sdk"
        : (m[2] ?? spec).replace(/[^a-z0-9-]/gi, "").toLowerCase();
      found.add(framework);
      if (underCap("llm-call")) {
        const pos = imp.getStart();
        push(
          out,
          sf,
          pos,
          "llm-call",
          "run",
          "info",
          `AI SDK import ("${spec}") — LLM code path lives here`,
          framework,
        );
      }
    }
    if (/promptfoo|deepeval|braintrust|langsmith|evalite|@venue(?:labs)?-eval/i.test(spec)) {
      push(
        out,
        sf,
        imp.getStart(),
        "eval",
        "test",
        "info",
        `Eval framework import ("${spec}") — LLM paths face tests`,
      );
    }
    if (TELEMETRY_IMPORT_RE.test(spec)) {
      push(
        out,
        sf,
        imp.getStart(),
        "runtime-guard",
        "run",
        "info",
        `Observability import ("${spec}") — AI path has telemetry`,
      );
    }
  }
  return found;
}

function detectCallSites(sf: SourceFile, out: Touchpoint[], frameworks: Set<string>): void {
  sf.forEachDescendant((node: TsNode) => {
    if (!Node.isCallExpression(node)) return;
    const call = node as CallExpression;
    const exprText = call.getExpression().getText();

    if (AI_METHOD_RE.test(exprText)) {
      const framework = frameworks.values().next().value ?? inferFramework(exprText);
      push(
        out,
        sf,
        call.getStart(),
        "llm-call",
        "run",
        "info",
        `LLM completion call ("${exprText}") — the runtime AI boundary`,
        framework,
      );
      return;
    }

    if (exprText === "fetch" || exprText === "axios" || exprText.endsWith(".post") || exprText.endsWith(".get")) {
      const firstArg = call.getArguments()[0];
      if (firstArg && Node.isStringLiteral(firstArg) && AI_ENDPOINT_RE.test(firstArg.getText())) {
        push(
          out,
          sf,
          call.getStart(),
          "llm-call",
          "run",
          "info",
          "Direct HTTP call to an LLM vendor endpoint",
          firstArg.getText().match(AI_ENDPOINT_RE)?.[1],
        );
      }
    }

    // tool registrations: tools.<name>({...}), defineTool({...}), agent.tool({...})
    if (/(^|\.)(defineTool|createTool|tool)(\(|$)/.test(exprText) && call.getArguments().length > 0) {
      const first = call.getArguments()[0];
      const looksLikeTool =
        (first && Node.isObjectLiteralExpression(first) && objectHasJsonSchemaShape(first as ObjectLiteralExpression)) ||
        /(^|\.)tools?\./.test(exprText);
      if (looksLikeTool) {
        push(
          out,
          sf,
          call.getStart(),
          "tool-definition",
          "design",
          "info",
          `Agent tool registered via "${exprText}" — tools are part of the attack surface`,
        );
      }
    }
  });
}

function inferFramework(exprText: string): string {
  if (/chat\.completions/.test(exprText)) return "openai-compatible";
  if (/messages\.create/.test(exprText)) return "anthropic-compatible";
  if (/generateContent/.test(exprText)) return "google-genai";
  return "llm";
}

function isInstructionTemplate(text: string): boolean {
  return text.length >= 40 && PROMPT_PHRASE_RE.test(text);
}

/** error-object member reads (err.message / e.stack) are not untrusted input */
const ERROR_MEMBER_RE = /\b(?:err|error|e|exception|errorEvent)\s*\.\s*(?:message|stack|name|code)\b/gi;

function isUntrustedInterpolation(interpolated: string): boolean {
  return UNTRUSTED_VAR_RE.test(interpolated.replace(ERROR_MEMBER_RE, ""));
}

/**
 * Chat-message injection: content/message/prompt properties whose value is a
 * template literal interpolating untrusted identifiers — the classic
 * `role: "user", content: `...${userMessage}`` injection surface.
 */
function detectMessageInjection(sf: SourceFile, out: Touchpoint[]): void {
  sf.forEachDescendant((node: TsNode) => {
    if (!Node.isPropertyAssignment(node)) return;
    const name = getPropertyName(node);
    if (!/^(content|text|prompt|message|query|input)$|message/i.test(name)) return;
    const init = node.getInitializer();
    if (!init || !Node.isTemplateExpression(init)) return;
    const interpolated = init
      .getTemplateSpans()
      .map((s) => s.getExpression().getText())
      .join(" ");
    if (isUntrustedInterpolation(interpolated)) {
      push(
        out,
        sf,
        node.getStart(),
        "injection",
        "secure",
        "high",
        `Untrusted input interpolated into a message field ("${name}: ...${init
          .getTemplateSpans()
          .slice(0, 2)
          .map((s) => s.getExpression().getText())}") — injection surface; delimit and validate external text`,
      );
    }
  });
}

function detectPromptLiterals(sf: SourceFile, out: Touchpoint[]): void {
  sf.forEachDescendant((node: TsNode) => {
    // prompt-named variables holding string/template literals
    if (Node.isVariableDeclaration(node)) {
      const name = node.getName();

      // tool-schema arrays: const TOOLS = [{ name, description, parameters }]
      if (/tools?$/i.test(name)) {
        const init = node.getInitializer();
        if (init && Node.isArrayLiteralExpression(init)) {
          for (const el of init.getElements()) {
            if (Node.isObjectLiteralExpression(el) && objectHasJsonSchemaShape(el)) {
              push(
                out,
                sf,
                node.getStart(),
                "tool-definition",
                "design",
                "info",
                `Tool schema array ("${name}") — every entry is model-invokable surface`,
              );
              break;
            }
          }
        }
      }

      if (/(prompt|instruction|system_?msg|sys_?msg|persona)/i.test(name)) {
        const init = node.getInitializer();
        if (
          init &&
          (Node.isStringLiteral(init) ||
            Node.isNoSubstitutionTemplateLiteral(init) ||
            Node.isTemplateExpression(init))
        ) {
          push(
            out,
            sf,
            node.getStart(),
            "prompt",
            "design",
            "low",
            `Prompt text in code ("${name}") — prompt-as-code should be versioned, reviewed, and owned`,
          );
        }
      }
    }

    // instruction-shaped template literals
    if (Node.isNoSubstitutionTemplateLiteral(node) || Node.isTemplateExpression(node)) {
      const text = node.getText();
      if (isInstructionTemplate(text)) {
        push(
          out,
          sf,
          node.getStart(),
          "prompt",
          "design",
          "low",
          "Instruction-shaped literal — natural-language behavior embedded in source",
        );
        detectInjectionInTemplate(sf, node, text, node.getStart(), out);
      }
    }
  });
}

function detectInjectionInTemplate(
  sf: SourceFile,
  node: TsNode,
  text: string,
  pos: number,
  out: Touchpoint[],
): void {
  if (!Node.isTemplateExpression(node)) return;
  const spans = node.getTemplateSpans();
  const interpolated = spans.map((s) => s.getExpression().getText()).join(" ");
  const promptish = isInstructionTemplate(text) || /prompt/i.test(text);
  if (promptish && isUntrustedInterpolation(interpolated)) {
    push(
      out,
      sf,
      pos,
      "injection",
      "secure",
      "high",
      `Untrusted input interpolated into a prompt (${spans
        .slice(0, 2)
        .map((s) => s.getExpression().getText())
        .join(", ")}) — injection surface; treat as hostile until delimited/validated`,
    );
  }
}

function detectSecrets(sf: SourceFile, out: Touchpoint[]): void {
  sf.forEachDescendant((node: TsNode) => {
    if (!Node.isStringLiteral(node) && !Node.isNoSubstitutionTemplateLiteral(node)) return;
    const value = node.getText().replace(/^["'`]|["'`]$/g, "");

    // credential-shaped literals
    if (/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/.test(value) && !PLACEHOLDER_VALUE_RE.test(value)) {
      push(
        out,
        sf,
        node.getStart(),
        "secret",
        "secure",
        "critical",
        "Credential-shaped literal committed in source — rotate and move to a secret manager",
      );
      return;
    }

    // generic hardcoded assignments: apiKey = "..." / "authorization": "Bearer ..."
    const line = snippetOf(sf, node.getStart());
    if (
      /\b(api[_-]?key|apikey|secret|access[_-]?token|auth[_-]?token|password)\b\s*[:=]\s*["'][^"']{8,}["']/i.test(line) &&
      !PLACEHOLDER_VALUE_RE.test(line) &&
      !line.includes("process.env")
    ) {
      push(
        out,
        sf,
        node.getStart(),
        "secret",
        "secure",
        "high",
        "Hardcoded credential-looking assignment — secrets belong in env/secret manager",
      );
      return;
    }

    // hardcoded model names
    if (MODEL_NAME_RE.test(value) && value.length < 64) {
      push(
        out,
        sf,
        node.getStart(),
        "model-ref",
        "design",
        "low",
        `Hardcoded model name ("${value}") — model ids should be config, not code`,
        "model-config",
      );
    }
  });
}

function detectPermissions(sf: SourceFile, out: Touchpoint[]): void {
  sf.forEachDescendant((node: TsNode) => {
    if (Node.isPropertyAssignment(node)) {
      const name = getPropertyName(node);
      if (name && DANGEROUS_PERM_KEY_RE.test(name)) {
        const init = node.getInitializer();
        const initText = init ? init.getText() : "";
        const boolTrue = /true|\[?\s*["'][^"']*["']/.test(initText);
        const wildcard = /\*|"all"|'all'|"write-all"/i.test(initText);
        if (boolTrue) {
          push(
            out,
            sf,
            node.getStart(),
            "agent-permission",
            "secure",
            wildcard ? "high" : "medium",
            `Broad agent permission "${name}: ${initText.slice(0, 40)}" — least-privilege tools instead`,
          );
        }
      }
      return;
    }

    // string-array grants: tools: ["*"] or allowedTools = ["shell", "write", "delete"]
    if (Node.isArrayLiteralExpression(node)) {
      const parent = node.getParent();
      if (parent && Node.isPropertyAssignment(parent)) {
        const name = getPropertyName(parent);
        if (name && /allowed[_-]?tools|allowedtools|tools/i.test(name)) {
          const elems = node.getElements().map((e) => e.getText());
          if (elems.includes('"*"') || elems.includes("'*'")) {
            push(
              out,
              sf,
              node.getStart(),
              "agent-permission",
              "secure",
              "high",
              'Tool grant includes "*" — every capability exposed to the model',
            );
          }
        }
      }
      return;
    }

    // MCP client configs in TS
    if (Node.isObjectLiteralExpression(node)) {
      const text = node.getText();
      if (/mcpServers/.test(text) && text.length < 2000) {
        push(
          out,
          sf,
          node.getStart(),
          "mcp-config",
          "design",
          "info",
          "MCP server configuration in source — every server is third-party tool surface",
        );
      }
    }
  });
}

function detectRuntimeGuards(sf: SourceFile, out: Touchpoint[]): void {
  const text = sf.getText();
  if (/\b(retry|backoff|withFallback|fallback)\b/i.test(text) && AI_METHOD_RE.test(text)) {
    const idx = text.search(/\b(retry|backoff|withFallback|fallback)\b/i);
    push(
      out,
      sf,
      idx >= 0 ? idx : sf.getStart(),
      "runtime-guard",
      "run",
      "info",
      "Retry/fallback logic near AI calls — production resilience signal",
    );
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface AstScanResult {
  touchpoints: Touchpoint[];
  frameworks: Set<string>;
  parsedFiles: number;
  /** code files discovered but not AST-parsed (cap) — still text-scanned */
  astSkipped: number;
}

export function scanCodeFiles(
  absPaths: string[],
  relByAbs: Map<string, string>,
  opts: { maxAstFiles?: number } = {},
): AstScanResult {
  const maxAstFiles = opts.maxAstFiles ?? 1000;
  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: true,
      jsx: 4, // ReactJSX
      esModuleInterop: true,
      target: 99, // Latest
    },
  });

  const touchpoints: Touchpoint[] = [];
  const frameworks = new Set<string>();
  let parsed = 0;
  let skipped = 0;

  for (const absPath of absPaths) {
    if (parsed >= maxAstFiles) {
      skipped += absPaths.length - parsed;
      break;
    }
    let sf: SourceFile | undefined;
    try {
      sf = project.addSourceFileAtPath(absPath);
    } catch {
      skipped += 1;
      continue;
    }
    parsed += 1;

    resetCaps();
    const local: Touchpoint[] = [];
    const fileFrameworks = detectImports(sf, local);
    fileFrameworks.forEach((f) => frameworks.add(f));
    detectCallSites(sf, local, fileFrameworks);
    detectPromptLiterals(sf, local);
    detectMessageInjection(sf, local);
    detectSecrets(sf, local);
    detectPermissions(sf, local);
    detectRuntimeGuards(sf, local);

    const rel = relByAbs.get(absPath) ?? absPath;
    for (const t of local) t.file = rel;
    touchpoints.push(...local);
  }

  return { touchpoints, frameworks, parsedFiles: parsed, astSkipped: skipped };
}

// keep the import used (SyntaxKind referenced indirectly by Node guards)
void SyntaxKind;
