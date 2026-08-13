import assert from 'node:assert/strict'

import { createTestBuildingGeometry } from '../src/modules/test-building-model.ts'

const model = createTestBuildingGeometry()

assert.equal(model.isReady, true)
assert.equal(model.walls.length, 2)
assert.deepEqual(model.walls.map((wall) => wall.heightMm), [2800, 4200])
assert.equal(model.walls[0]?.openings[0]?.type, 'door')
assert.equal(model.walls[1]?.openings[0]?.type, 'window')
assert.equal(model.walls[0]?.openings[0]?.offsetMm, 1700)
assert.equal(model.walls[1]?.openings[0]?.sillHeightMm, 900)
assert.equal(model.walls.every((wall) => wall.lengthMm > 0 && wall.thicknessMm > 0), true)
assert.equal(model.walls.every((wall) => wall.sourceReferences[0]?.fileName === '3D 화면 확인용 테스트 모델'), true)

console.log('3D test geometry verification passed: heights, openings, zones, and source marker are present.')
