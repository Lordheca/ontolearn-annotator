import { describe, it, expect } from "vitest";
import { sortByPosition } from "../class-types-order";

describe("sortByPosition", () => {
  it("puts positioned classes first, in position order, then the rest as they came", () => {
    const sorted = sortByPosition([
      { name: "Zeta", position: null },
      { name: "No crystal", position: 25 },
      { name: "Alpha", position: null },
      { name: "Microparticle", position: 0 },
    ]);
    expect(sorted.map((classType) => classType.name)).toEqual([
      "Microparticle",
      "No crystal",
      "Zeta",
      "Alpha",
    ]);
  });

  it("keeps the incoming order when no class has a position", () => {
    const input = [
      { name: "B", position: null },
      { name: "A", position: null },
    ];
    expect(sortByPosition(input)).toEqual(input);
  });
});