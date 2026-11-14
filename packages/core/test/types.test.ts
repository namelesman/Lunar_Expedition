import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTE_PARAMS, MOON_RADIUS_KM, MOON_RADIUS_M } from "../src";

describe("shared constants", () => {
  it("uses the LOLA reference radius", () => {
    expect(MOON_RADIUS_KM).toBe(1737.4);
    expect(MOON_RADIUS_M).toBe(1_737_400);
  });
  it("defaults the rover max slope to 15 degrees", () => {
    expect(DEFAULT_ROUTE_PARAMS.maxSlopeDeg).toBe(15);
  });
});
