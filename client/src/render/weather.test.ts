import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { covered, coversNear, LOOKS, lookFor, WeatherFx } from "./weather.ts";

test("weather looks follow the spec table", () => {
  assert.deepEqual(LOOKS.sisli.fog, [600, 3500]);
  assert.equal(LOOKS.firtina.lightning, true);
  assert.equal(LOOKS.yagmurlu.rain, 1500);
  assert.equal(LOOKS.gece.night, true);
  assert.equal(LOOKS.bulutlu.clouds.count, 140);
  assert.equal(lookFor("bilinmeyen", false), LOOKS.acik);
});

test("performance mode halves clouds and caps rain", () => {
  const p = lookFor("firtina", true);
  assert.equal(p.clouds.count, 80);
  assert.equal(p.rain, 600);
});

test("no rain under a hangar or building roof", () => {
  const roof = [0, 0, 0, 40, 12, 30];
  const far = [5000, 0, 5000, 5040, 12, 5030];
  const near = coversNear([roof, far], 10, 10);
  assert.deepEqual(near, [roof]);
  assert.equal(covered(near, 20, 5, 15), true);   // inside, below the roof top
  assert.equal(covered(near, 20, 13, 15), false); // above the roof
  assert.equal(covered(near, 50, 5, 15), false);  // beside the hangar
});

test("setRain swaps the streaks mid-game (performance mode)", () => {
  const scene = new THREE.Scene();
  const fx = new WeatherFx(scene, LOOKS.yagmurlu, 1);
  const count = () => {
    const r = scene.getObjectByName("rain") as THREE.LineSegments | undefined;
    return r ? r.geometry.attributes.position.count / 2 : 0;
  };
  assert.equal(count(), 1500);
  fx.setRain(lookFor("yagmurlu", true).rain);
  assert.equal(count(), 600);
  assert.equal(scene.children.filter((c) => c.name === "rain").length, 1);
  fx.setRain(0);
  assert.equal(count(), 0);
});
