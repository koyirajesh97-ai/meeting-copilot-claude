// The live meeting connection lives in @meeting-copilot/shared (the phone app uses it too).
import { LiveConnection as SharedLive, type LiveOptions } from "@meeting-copilot/shared";
import type { StartOptions } from "../../shared/ipc";

export class LiveConnection extends SharedLive<StartOptions> {
  constructor(opts: LiveOptions<StartOptions>) {
    super(opts);
  }
}
