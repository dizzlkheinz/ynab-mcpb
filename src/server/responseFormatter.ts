class ResponseFormatter {
	format(value: unknown): string {
		return JSON.stringify(value, null, 2);
	}
}

export const responseFormatter = new ResponseFormatter();
