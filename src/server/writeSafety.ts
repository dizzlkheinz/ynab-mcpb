import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const WRITE_MODES = ["read-only", "preview", "enabled"] as const;

export type WriteMode = (typeof WRITE_MODES)[number];

export const DEFAULT_WRITE_MODE: WriteMode = "preview";
export const DEFAULT_CONFIRMATION_TTL_MS = 2 * 60 * 1000;

interface ConfirmationRecord {
	digest: Buffer;
	expiresAt: number;
}

export type ConfirmationResult =
	| { ok: true }
	| { ok: false; reason: "expired" | "invalid" | "reused" };

export interface WriteSafetyPolicyOptions {
	mode?: WriteMode;
	ttlMs?: number;
	now?: () => number;
	tokenFactory?: () => string;
}

export interface IssuedConfirmation {
	token: string;
	expiresAt: string;
}

/**
 * Central policy for all YNAB mutations.
 *
 * Confirmation records intentionally live only in memory. A server restart
 * invalidates every outstanding token, which is safer than persisting approval
 * for a financial write across processes.
 */
export class WriteSafetyPolicy {
	readonly mode: WriteMode;
	private readonly ttlMs: number;
	private readonly now: () => number;
	private readonly tokenFactory: () => string;
	private readonly confirmations = new Map<string, ConfirmationRecord>();
	private readonly consumedTokens = new Map<string, number>();

	constructor(options: WriteSafetyPolicyOptions = {}) {
		this.mode = options.mode ?? DEFAULT_WRITE_MODE;
		this.ttlMs = options.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
		this.now = options.now ?? Date.now;
		this.tokenFactory =
			options.tokenFactory ?? (() => randomBytes(18).toString("base64url"));

		if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
			throw new Error("Write confirmation TTL must be a positive number");
		}
	}

	shouldRegisterMutation(): boolean {
		return this.mode !== "read-only";
	}

	requiresConfirmation(): boolean {
		return this.mode === "preview";
	}

	issue(
		toolName: string,
		validatedArguments: Record<string, unknown>,
	): IssuedConfirmation {
		this.prune();
		const token = this.tokenFactory();
		const expiresAt = this.now() + this.ttlMs;
		this.confirmations.set(token, {
			digest: this.digest(toolName, validatedArguments),
			expiresAt,
		});
		return { token, expiresAt: new Date(expiresAt).toISOString() };
	}

	consume(
		token: string,
		toolName: string,
		validatedArguments: Record<string, unknown>,
	): ConfirmationResult {
		const now = this.now();

		const consumedUntil = this.consumedTokens.get(token);
		if (consumedUntil !== undefined && consumedUntil > now) {
			return { ok: false, reason: "reused" };
		}

		const record = this.confirmations.get(token);
		if (!record) {
			this.prune(now);
			return { ok: false, reason: "invalid" };
		}

		// Consume before comparison so a failed altered-argument attempt cannot
		// preserve a token for later reuse.
		this.confirmations.delete(token);
		this.consumedTokens.set(token, record.expiresAt);

		if (record.expiresAt <= now) {
			this.consumedTokens.delete(token);
			return { ok: false, reason: "expired" };
		}

		const candidate = this.digest(toolName, validatedArguments);
		if (
			candidate.length !== record.digest.length ||
			!timingSafeEqual(candidate, record.digest)
		) {
			return { ok: false, reason: "invalid" };
		}

		return { ok: true };
	}

	private digest(
		toolName: string,
		validatedArguments: Record<string, unknown>,
	): Buffer {
		return createHash("sha256")
			.update(toolName)
			.update("\0")
			.update(canonicalJson(validatedArguments))
			.digest();
	}

	private prune(now = this.now()): void {
		for (const [token, record] of this.confirmations) {
			if (record.expiresAt <= now) {
				this.confirmations.delete(token);
			}
		}
		for (const [token, expiresAt] of this.consumedTokens) {
			if (expiresAt <= now) {
				this.consumedTokens.delete(token);
			}
		}
	}
}

/** Stable JSON representation used only for already-validated tool input. */
export function canonicalJson(value: unknown): string {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error("Cannot confirm non-finite numeric arguments");
		}
		return JSON.stringify(Object.is(value, -0) ? 0 : value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([left], [right]) => left.localeCompare(right));
		return `{${entries
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
			.join(",")}}`;
	}
	throw new Error(`Cannot confirm argument of type ${typeof value}`);
}
