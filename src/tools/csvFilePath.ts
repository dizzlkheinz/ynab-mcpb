import { fileURLToPath } from "node:url";

/**
 * Build candidate CSV paths across common runtime/path-style boundaries.
 * The first candidate is always the original path.
 */
export function resolveCsvPathCandidates(
	inputPath: string,
	platform = process.platform,
): string[] {
	const trimmed = inputPath.trim();
	if (!trimmed) {
		return [];
	}

	const candidates: string[] = [];
	const addCandidate = (candidate: string | undefined) => {
		if (!candidate || candidates.includes(candidate)) {
			return;
		}
		candidates.push(candidate);
	};

	addCandidate(trimmed);

	if (trimmed.startsWith("file://")) {
		try {
			addCandidate(fileURLToPath(trimmed));
		} catch {
			// Ignore invalid file URL and keep original candidate.
		}
	}

	if (platform === "win32") {
		const wslDriveMatch = trimmed.match(/^\/mnt\/([a-zA-Z])\/(.+)$/);
		if (wslDriveMatch?.[1] && wslDriveMatch[2]) {
			addCandidate(toWindowsPath(wslDriveMatch[1], wslDriveMatch[2]));
		}

		const lowered = trimmed.toLowerCase();
		if (!lowered.startsWith("/mnt/")) {
			const unixDriveMatch = trimmed.match(/^\/([a-zA-Z])\/(.+)$/);
			if (unixDriveMatch?.[1] && unixDriveMatch[2]) {
				addCandidate(toWindowsPath(unixDriveMatch[1], unixDriveMatch[2]));
			}
		}
	} else {
		const windowsPathMatch = trimmed.match(/^([a-zA-Z]):[\\/](.+)$/);
		if (windowsPathMatch?.[1] && windowsPathMatch[2]) {
			addCandidate(toWslPath(windowsPathMatch[1], windowsPathMatch[2]));
		}
	}

	return candidates;
}

function toWindowsPath(driveLetter: string, rest: string): string {
	return `${driveLetter.toUpperCase()}:\\${rest.replace(/\//g, "\\")}`;
}

function toWslPath(driveLetter: string, rest: string): string {
	return `/mnt/${driveLetter.toLowerCase()}/${rest.replace(/\\/g, "/")}`;
}
