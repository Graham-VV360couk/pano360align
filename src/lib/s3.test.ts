import { describe, it, expect } from "vitest";
import { jobKey } from "./s3";

describe("jobKey", () => {
  it("builds the input key with extension", () => {
    expect(jobKey("abc", "input", "mov")).toBe("jobs/abc/input.mov");
  });
  it("defaults extension to mp4", () => {
    expect(jobKey("abc", "input")).toBe("jobs/abc/input.mp4");
  });
  it("builds the output key", () => {
    expect(jobKey("abc", "output")).toBe("jobs/abc/output.mp4");
  });
  it("builds the metadata key", () => {
    expect(jobKey("abc", "job")).toBe("jobs/abc/job.json");
  });
});
