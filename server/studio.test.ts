import { describe, expect, test } from "bun:test";
import { normalizeStudioScene } from "./config.ts";
import { createCustomOverlay, deleteOverlay } from "./services/overlays.ts";

describe("Overlay Studio normalization & safety", () => {
  test("returns default 1920x1080 empty scene for invalid input", () => {
    expect(normalizeStudioScene(null)).toEqual({
      width: 1920,
      height: 1080,
      layers: [],
    });
    expect(normalizeStudioScene("bad")).toEqual({
      width: 1920,
      height: 1080,
      layers: [],
    });
  });

  test("clamps dimensions, filters studio self-reference, and sanitizes layer fields", () => {
    const result = normalizeStudioScene({
      width: 99999,
      height: 100,
      layers: [
        { overlayId: "studio", id: "recursive" },
        {
          id: "l1",
          overlayId: "spotify-card/../evil",
          name: "Spotify Widget",
          x: 120.7,
          y: -15.2,
          width: 10,
          height: 5,
          scale: 12,
          opacity: -1,
          zIndex: 3,
          visible: false,
          locked: 1,
        },
      ],
    });

    expect(result.width).toBe(7680);
    expect(result.height).toBe(240);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]).toEqual({
      id: "l1",
      overlayId: "spotify-cardevil",
      name: "Spotify Widget",
      x: 121,
      y: -15,
      width: 40,
      height: 20,
      scale: 5,
      opacity: 0,
      zIndex: 3,
      visible: false,
      locked: true,
    });
  });

  test("guards reserved 'studio' ID when creating custom overlays", () => {
    const created = createCustomOverlay({
      id: "studio",
      name: "Attempt Reserved ID",
    });
    try {
      expect(created.id).toBe("custom-studio");
    } finally {
      deleteOverlay(created.id);
    }
  });
});
