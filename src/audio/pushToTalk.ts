export type PushToTalkConnection = {
  commit: () => void;
  mute: () => void;
};

export type MicrophoneEnvironment = {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  hostname: string;
};

type Scheduler = (callback: () => void, delay: number) => unknown;
type Sleeper = (delay: number) => Promise<void>;

const defaultScheduler: Scheduler = (callback, delay) => globalThis.setTimeout(callback, delay);

export function finishPushToTalk(connection: PushToTalkConnection, schedule: Scheduler = defaultScheduler) {
  connection.commit();
  return schedule(() => connection.mute(), 180);
}

export function diagnoseMicrophoneEnvironment(environment: MicrophoneEnvironment): string | null {
  if (!environment.isSecureContext && environment.hostname !== "localhost" && environment.hostname !== "127.0.0.1") {
    return `Microphone blocked by the browser. Open the game over HTTPS or at http://localhost. To allow on LAN Chrome: open chrome://flags/#unsafely-treat-insecure-origin-as-secure, add http://${environment.hostname}:5173, enable & relaunch.`;
  }
  if (!environment.hasGetUserMedia) {
    return "This browser cannot access a microphone here. Check microphone permission, then reload and retry.";
  }
  return null;
}

export function describeMicrophoneAccessError(error: { name?: string; message?: string }) {
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "Microphone permission is blocked. Click the site-controls icon beside the address bar, allow Microphone in site settings, then press retry.";
  }
  if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
    return "No microphone was found. Connect or enable an input device, then press retry.";
  }
  if (error.name === "NotReadableError" || error.name === "AbortError") {
    return "Windows could not open the microphone. Close another application using it and check Windows microphone privacy settings.";
  }
  return error.message ? `Microphone access failed: ${error.message}` : "Microphone access failed. Check browser site permissions and press retry.";
}

export async function waitForMicrophoneReady(
  isReady: () => boolean,
  sleep: Sleeper = (delay) => new Promise((resolve) => globalThis.setTimeout(resolve, delay)),
  maxChecks = 80
) {
  for (let check = 0; check < maxChecks; check += 1) {
    if (isReady()) return true;
    await sleep(100);
  }
  return false;
}
