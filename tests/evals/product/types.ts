import type { WorkflowType } from "../../../src/routing/types.js";
import type { EvalTrace } from "../types.js";

export type PromptFamily =
  | "single_asset"
  | "compare_assets"
  | "portfolio"
  | "options"
  | "sentiment"
  | "macro"
  | "education";

export interface ProductEvalDimension {
  id: string;
  description: string;
  expectedWorkflow?: WorkflowType;
  requiredPatterns?: RegExp[];
  forbiddenPatterns?: RegExp[];
  requiredToolNames?: string[];
  forbiddenToolNames?: string[];
  expectedAskUserCount?: number;
  askUserQuestionPatterns?: RegExp[];
  requiredResolvedSymbols?: string[];
  forbiddenResolvedSymbols?: string[];
  mandatory?: boolean;
  weight?: number;
}

export interface ScenarioTemplate {
  id: string;
  family: PromptFamily;
  description: string;
  dimensions: ProductEvalDimension[];
}

export interface ProductEvalCase {
  id: string;
  templateId: string;
  family: PromptFamily;
  tier?: "default" | "opt-in";
  prompt: string;
  prompts?: string[];
  answers?: string[];
  setup?: {
    marketStateFixture?: "e5_two_option_positions";
  };
  assertions?: {
    expectedWorkflow?: WorkflowType;
    requiredTools?: string[];
    forbiddenTools?: string[];
  };
  dimensions: ProductEvalDimension[];
}

export interface ProductDimensionResult {
  id: string;
  description: string;
  passed: boolean;
  score: number;
  weight: number;
  mandatory: boolean;
  message: string;
}

export interface ProductEvalCaseResult {
  id: string;
  family: PromptFamily;
  prompt: string;
  score: number;
  passed: boolean;
  mandatoryFailure: boolean;
  dimensions: ProductDimensionResult[];
  trace?: EvalTrace;
}

export interface ProductEvalReport {
  generatedAt: string;
  caseCount: number;
  aggregate: number;
  passed: number;
  failed: number;
  byFamily: Partial<Record<PromptFamily, ProductEvalSummaryBucket>>;
  byDimension: Record<string, ProductEvalDimensionBucket>;
  results: ProductEvalCaseResult[];
}

export interface ProductEvalSummaryBucket {
  caseCount: number;
  aggregate: number;
  passed: number;
  failed: number;
}

export interface ProductEvalDimensionBucket {
  passed: number;
  failed: number;
}
