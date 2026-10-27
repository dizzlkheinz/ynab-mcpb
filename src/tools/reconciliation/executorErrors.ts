export interface NormalizedYnabError {
	status?: number;
	name?: string;
	message: string;
	detail?: string;
}

export function normalizeYnabError(error: unknown): NormalizedYnabError {
	const parseStatus = (value: unknown): number | undefined => {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string") {
			const numeric = Number(value);
			if (Number.isFinite(numeric)) return numeric;
		}
		return undefined;
	};

	if (error instanceof Error) {
		const status =
			parseStatus((error as { status?: unknown }).status) ??
			parseStatus(
				(error as { response?: { status?: unknown } }).response?.status,
			);
		const detailSource = (error as { detail?: unknown }).detail;
		const detail =
			typeof detailSource === "string" && detailSource.trim().length > 0
				? detailSource
				: undefined;

		const result: NormalizedYnabError = {
			name: error.name,
			message: error.message || "Unknown error occurred",
		};

		if (status !== undefined) result.status = status;
		if (detail !== undefined) result.detail = detail;

		return result;
	}

	if (error && typeof error === "object") {
		const errObj = (error as { error?: unknown }).error ?? error;
		const status = parseStatus(
			(errObj as { id?: unknown }).id ??
				(errObj as { status?: unknown }).status,
		);
		const detailCandidate =
			(errObj as { detail?: unknown }).detail ??
			(errObj as { message?: unknown }).message ??
			(errObj as { name?: unknown }).name;
		const detail =
			typeof detailCandidate === "string" && detailCandidate.trim().length > 0
				? detailCandidate
				: undefined;
		const message =
			detail ??
			(typeof errObj === "string" && errObj.trim().length > 0
				? errObj
				: "Unknown error occurred");
		const name =
			typeof (errObj as { name?: unknown }).name === "string"
				? ((errObj as { name: string }).name as string)
				: undefined;

		const result: NormalizedYnabError = { message };

		if (status !== undefined) result.status = status;
		if (name !== undefined) result.name = name;
		if (detail !== undefined) result.detail = detail;

		return result;
	}

	if (typeof error === "string") {
		return { message: error };
	}

	return { message: "Unknown error occurred" };
}
