class ResponseFormatter {
	format(value: unknown): string {
		return JSON.stringify(value);
	}
}

export const responseFormatter = new ResponseFormatter();
