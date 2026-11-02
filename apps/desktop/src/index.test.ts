import { expect, it } from "vitest";
import { APP_NAME } from "./index";

it("has a name", () => {
  expect(APP_NAME).toBe("Meeting Copilot");
});
