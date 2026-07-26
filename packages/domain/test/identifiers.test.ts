import { describe, expect, it } from "vitest";

import { IDENTIFIER_BRANDS, unsafeIdentifier } from "../src/identifiers.js";
import type { EmployeeId, WorksiteId } from "../src/identifiers.js";

describe("Bezeichner", () => {
  it("bleibt zur Laufzeit der rohe String", () => {
    const id = unsafeIdentifier<EmployeeId>("00000000-0000-0000-0000-00000000aaa1");
    expect(id).toBe("00000000-0000-0000-0000-00000000aaa1");
    expect(typeof id).toBe("string");
  });

  it("führt jede Bezeichnerart genau einmal", () => {
    expect(new Set(IDENTIFIER_BRANDS).size).toBe(IDENTIFIER_BRANDS.length);
  });

  it("trennt Bezeichnerarten auf Typebene", () => {
    const employee = unsafeIdentifier<EmployeeId>("a");
    // @ts-expect-error EmployeeId ist keine WorksiteId — genau dafür existiert das Branding.
    const worksite: WorksiteId = employee;
    // Laufzeitwert ist identisch; die Trennung wirkt ausschließlich im Typsystem.
    expect(worksite).toBe("a");
  });
});
