import {
	type ExecutionOptions,
	type ExecutionResult,
	executeReconciliationPlan,
} from "../executor.js";
import { buildReconciliationPlan } from "../plan.js";

/** Builds the plan from the options and executes it, as a confirmed preview does. */
export function executeReconciliation(
	options: ExecutionOptions,
): Promise<ExecutionResult> {
	return executeReconciliationPlan(buildReconciliationPlan(options), options);
}
