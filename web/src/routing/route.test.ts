import { describe, expect, it } from "vitest";

import { buildPartPath, parseAppPath } from "./route";

describe("parseAppPath", () => {
  it("treats the GH Pages base path root as home", () => {
    expect(parseAppPath("/part-registry/")).toEqual({ kind: "home" });
  });

  it("normalizes hyphenated mixed-case IDs into the canonical part route", () => {
    expect(parseAppPath("/part-registry/abCd-efGh-jkMn-pQ")).toEqual({
      kind: "part",
      id: "ABCDEFGHJKMNPQ",
    });
  });

  it("reports invalid normalized IDs explicitly", () => {
    expect(parseAppPath("/part-registry/ABCD-0FGH-JKMN-PQ")).toEqual({
      kind: "invalid-part-id",
      rawSegment: "ABCD-0FGH-JKMN-PQ",
      normalized: "ABCD0FGHJKMNPQ",
    });
  });

  it("ignores extra path depth for now", () => {
    expect(parseAppPath("/part-registry/ABCD-EFGH-JKMN-PQ/history")).toEqual({
      kind: "home",
    });
  });

  it("builds the canonical part path under the configured base path", () => {
    expect(buildPartPath("abCd-efGh-jkMn-pQ", "/part-registry/")).toBe(
      "/part-registry/ABCDEFGHJKMNPQ",
    );
  });
});
